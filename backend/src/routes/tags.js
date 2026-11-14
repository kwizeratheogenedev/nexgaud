import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { Tag, TAG_KINDS, MAX_TAGS_PER_USER, MAX_TAGS_PER_ORG } from '../models/Tag.js';
import { TagThread, MAX_THREAD_MESSAGES } from '../models/TagThread.js';
import { Org } from '../models/Org.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { normalizeCode } from '../lib/codes.js';
import { normalizePhone } from '../lib/phone.js';
import { objectId, validate } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { managedOrgIds, scopeFor } from '../services/access.js';
import { newTagCode, notifyTag, tagUrl, textFinder } from '../services/tags.js';

/**
 * QR lost-and-found tags.
 * - /tags/public/...: the finder's side, no sign-in (scan, read the owner's message, write back).
 * - /tags/...: the owner's side (their tags, or their organisation's), and the conversations.
 */
const router = Router();

const limiter = (limit, windowMs) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (_req, _res, next) => next(tooMany()),
  });

const MAX_OPEN_THREADS_PER_TAG = 20;
const CLAIM_MAX_ATTEMPTS = 5;
const locationField = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100000).optional() })
  .optional();
const codeParams = validate(z.object({ code: z.string().min(6).max(16) }), 'params');

// ---- Finder's side (public) ----

const publicRouter = Router();
publicRouter.use(limiter(60, 15 * 60 * 1000));

async function tagByCode(raw) {
  const tag = await Tag.findOne({ code: normalizeCode(raw) });
  if (!tag) throw notFound('Tag');
  return tag;
}

/** What a finder may see: the item and the owner's message. Never who the owner is (an organisation's name is fine). */
async function finderView(tag) {
  let orgName = null;
  if (tag.orgId) {
    orgName = (await Org.findById(tag.orgId).select('name'))?.name ?? null;
  }
  if (tag.status === 'unclaimed' || tag.status === 'disabled') return { code: tag.code, status: tag.status };
  return { code: tag.code, status: tag.status, name: tag.name ?? null, kind: tag.kind, message: tag.message ?? null, orgName };
}

publicRouter.get(
  '/:code',
  codeParams,
  validate(z.object({ repeat: z.enum(['1']).optional() }), 'query'),
  async (req, res) => {
    const tag = await tagByCode(req.valid.params.code);
    // The finder page sends repeat=1 when this browser already opened the tag, so reloads are not new scans.
    if (['active', 'lost'].includes(tag.status) && !req.valid.query.repeat) {
      tag.scans += 1;
      tag.lastScanAt = new Date();
      await tag.save();
      // A scan is always an alert; it is texted only while the item is marked lost.
      await notifyTag(tag, 'tag_scanned', { sms: tag.status === 'lost' });
    }
    res.json({ tag: await finderView(tag) });
  },
);

publicRouter.post(
  '/:code/threads',
  limiter(5, 60 * 60 * 1000),
  codeParams,
  validate(
    z.object({
      message: z.string().trim().min(2).max(500),
      contactPhone: z.string().trim().max(20).optional(),
      shareContact: z.boolean().default(false),
      location: locationField,
      language: z.enum(['rw', 'en', 'fr']).default('en'),
    }),
  ),
  async (req, res) => {
    const tag = await tagByCode(req.valid.params.code);
    if (!['active', 'lost'].includes(tag.status)) throw notFound('Tag');
    const { message, shareContact, location, language } = req.valid.body;
    const finderPhone = req.valid.body.contactPhone ? normalizePhone(req.valid.body.contactPhone) : null;
    if (req.valid.body.contactPhone && !finderPhone) throw badRequest('contact_invalid', 'Enter a valid phone number');
    if ((await TagThread.countDocuments({ tagId: tag._id, status: 'open' })) >= MAX_OPEN_THREADS_PER_TAG) {
      throw tooMany('This tag has too many open conversations');
    }
    const token = randomToken(24);
    const thread = await TagThread.create({
      tagId: tag._id,
      ownerId: tag.ownerId,
      orgId: tag.orgId,
      finderTokenHash: hmac(`thread:${token}`),
      finderPhone: finderPhone ?? undefined,
      shareFinderPhone: Boolean(finderPhone && shareContact),
      finderLanguage: language,
      messages: [{ from: 'finder', text: message, location }],
    });
    await notifyTag(tag, 'tag_message', { threadId: thread._id, message, smsCooldownMs: 10 * 60 * 1000 });
    // The token is the finder's only key to the conversation; the page keeps it in the browser.
    res.status(201).json({ token, thread: thread.toFinder() });
  },
);

async function threadByToken(token) {
  const thread = await TagThread.findOne({ finderTokenHash: hmac(`thread:${token}`) });
  if (!thread) throw notFound('Conversation');
  return thread;
}

const tokenParams = validate(z.object({ token: z.string().min(20).max(64) }), 'params');

publicRouter.get('/threads/:token', tokenParams, async (req, res) => {
  const thread = await threadByToken(req.valid.params.token);
  res.json({ thread: thread.toFinder() });
});

publicRouter.post(
  '/threads/:token/messages',
  limiter(20, 60 * 60 * 1000),
  tokenParams,
  validate(z.object({ text: z.string().trim().min(1).max(500), location: locationField })),
  async (req, res) => {
    const thread = await threadByToken(req.valid.params.token);
    if (thread.status !== 'open') throw badRequest('thread_closed', 'The owner closed this conversation');
    if (thread.messages.length >= MAX_THREAD_MESSAGES) throw tooMany('This conversation is full');
    thread.messages.push({ from: 'finder', text: req.valid.body.text, location: req.valid.body.location });
    thread.lastMessageAt = new Date();
    await thread.save();
    const tag = await Tag.findById(thread.tagId);
    if (tag) await notifyTag(tag, 'tag_message', { threadId: thread._id, message: req.valid.body.text, smsCooldownMs: 10 * 60 * 1000 });
    res.status(201).json({ thread: thread.toFinder() });
  },
);

router.use('/public', publicRouter);

// ---- Owner's side ----

router.use(requireUser);

const tagFields = {
  name: z.string().trim().min(1).max(40),
  kind: z.enum(TAG_KINDS).default('other'),
  message: z.string().trim().max(300).optional(),
};
const idParams = validate(z.object({ id: objectId }), 'params');

async function scopedTag(req) {
  const tag = await Tag.findOne({ _id: req.valid.params.id, status: { $ne: 'disabled' }, ...(await scopeFor(req.user)) });
  if (!tag) throw notFound('Tag');
  return tag;
}

/** Checks the user may put a tag in this organisation, and that there is room. */
async function checkRoom(req, orgId) {
  if (orgId) {
    const managed = await managedOrgIds(req.user);
    if (!managed.some((id) => String(id) === orgId)) throw notFound('Organisation');
    if ((await Tag.countDocuments({ orgId, status: { $ne: 'disabled' } })) >= MAX_TAGS_PER_ORG) {
      throw badRequest('tag_limit', `An organisation can have up to ${MAX_TAGS_PER_ORG} tags`);
    }
  } else if ((await Tag.countDocuments({ ownerId: req.user._id, orgId: null, status: { $ne: 'disabled' } })) >= MAX_TAGS_PER_USER) {
    throw badRequest('tag_limit', `You can have up to ${MAX_TAGS_PER_USER} tags`);
  }
}

async function withThreads(tags) {
  const counts = await TagThread.aggregate([
    { $match: { tagId: { $in: tags.map((t) => t._id) } } },
    {
      $group: {
        _id: '$tagId',
        threads: { $sum: 1 },
        unread: { $sum: { $cond: [{ $or: [{ $eq: [{ $ifNull: ['$ownerReadAt', null] }, null] }, { $lt: ['$ownerReadAt', '$lastMessageAt'] }] }, 1, 0] } },
      },
    },
  ]);
  return tags.map((t) => {
    const c = counts.find((x) => String(x._id) === t.id);
    return { ...t.toPublic(), url: tagUrl(t.code), threads: c?.threads ?? 0, unreadThreads: c?.unread ?? 0 };
  });
}

router.get('/', async (req, res) => {
  const tags = await Tag.find({ status: { $ne: 'disabled' }, ...(await scopeFor(req.user)) }).sort({ createdAt: -1 });
  res.json({ tags: await withThreads(tags) });
});

// Tags made by the owner (printed at home): active at once.
router.post('/', validate(z.object({ ...tagFields, orgId: objectId.optional(), count: z.number().int().min(1).max(20).default(1) })), async (req, res) => {
  const { count, orgId, ...fields } = req.valid.body;
  await checkRoom(req, orgId);
  const tags = [];
  for (let i = 0; i < count; i++) {
    tags.push(
      await Tag.create({
        ...fields,
        name: count > 1 ? `${fields.name} ${i + 1}` : fields.name,
        code: await newTagCode(),
        status: 'active',
        ownerId: req.user._id,
        orgId,
        claimedAt: new Date(),
      }),
    );
  }
  await audit(req, 'tag.created', tags[0], { count, orgId: orgId ?? null });
  res.status(201).json({ tags: await withThreads(tags) });
});

// Tags from a printed sheet (bought in a shop): the code from the QR plus the claim code printed beside it.
router.post(
  '/claim',
  validate(z.object({ code: z.string().trim().min(6).max(16), claimCode: z.string().trim().min(4).max(10), ...tagFields, orgId: objectId.optional() })),
  async (req, res) => {
    const { code, claimCode, orgId, ...fields } = req.valid.body;
    const tag = await Tag.findOne({ code: normalizeCode(code) });
    if (!tag || tag.status !== 'unclaimed') throw badRequest('tag_unavailable', 'This tag does not exist or is already in use');
    if (tag.claimAttempts >= CLAIM_MAX_ATTEMPTS) throw tooMany('Too many wrong claim codes for this tag. Contact NexGuard.');
    if (normalizeCode(claimCode) !== tag.claimCode) {
      tag.claimAttempts += 1;
      await tag.save();
      throw badRequest('claim_code', 'Wrong claim code');
    }
    await checkRoom(req, orgId);
    Object.assign(tag, { ...fields, status: 'active', ownerId: req.user._id, orgId, claimedAt: new Date(), claimCode: undefined });
    await tag.save();
    await audit(req, 'tag.claimed', tag, { batchId: tag.batchId ? String(tag.batchId) : null });
    const [full] = await withThreads([tag]);
    res.json({ tag: full });
  },
);

router.patch(
  '/:id',
  idParams,
  validate(
    z.object({
      name: tagFields.name.optional(),
      kind: z.enum(TAG_KINDS).optional(),
      message: z.string().trim().max(300).optional(),
      status: z.enum(['active', 'lost']).optional(),
    }),
  ),
  async (req, res) => {
    const tag = await scopedTag(req);
    const { status, ...rest } = req.valid.body;
    Object.assign(tag, rest);
    if (status && status !== tag.status) {
      tag.status = status;
      tag.lostSince = status === 'lost' ? new Date() : undefined;
    }
    await tag.save();
    const [full] = await withThreads([tag]);
    res.json({ tag: full });
  },
);

// The sticker stops working: the finder page says the tag is no longer in use. Conversations are deleted.
router.delete('/:id', idParams, async (req, res) => {
  const tag = await scopedTag(req);
  tag.status = 'disabled';
  await tag.save();
  await TagThread.deleteMany({ tagId: tag._id });
  await audit(req, 'tag.disabled', tag);
  res.status(204).end();
});

// Conversations with finders.
router.get('/threads/all', validate(z.object({ tagId: objectId.optional() }), 'query'), async (req, res) => {
  const tags = await Tag.find({ status: { $ne: 'disabled' }, ...(await scopeFor(req.user)) }).select('_id');
  let tagIds = tags.map((t) => t._id);
  if (req.valid.query.tagId) tagIds = tagIds.filter((id) => String(id) === req.valid.query.tagId);
  const threads = await TagThread.find({ tagId: { $in: tagIds } }).sort({ lastMessageAt: -1 }).limit(100);
  res.json({ threads: threads.map((t) => t.toOwner()) });
});

async function scopedThread(req) {
  const thread = await TagThread.findById(req.valid.params.id);
  if (!thread) throw notFound('Conversation');
  const tag = await Tag.findOne({ _id: thread.tagId, ...(await scopeFor(req.user)) });
  if (!tag) throw notFound('Conversation');
  return { thread, tag };
}

router.post('/threads/:id/read', idParams, async (req, res) => {
  const { thread } = await scopedThread(req);
  thread.ownerReadAt = new Date();
  await thread.save();
  res.json({ thread: thread.toOwner() });
});

router.post('/threads/:id/reply', idParams, validate(z.object({ text: z.string().trim().min(1).max(500) })), async (req, res) => {
  const { thread, tag } = await scopedThread(req);
  if (thread.status !== 'open') throw badRequest('thread_closed', 'This conversation is closed');
  if (thread.messages.length >= MAX_THREAD_MESSAGES) throw tooMany('This conversation is full');
  thread.messages.push({ from: 'owner', text: req.valid.body.text, by: req.user._id });
  thread.lastMessageAt = new Date();
  thread.ownerReadAt = thread.lastMessageAt;
  await thread.save();
  // The finder sees replies on the tag page; if they left a number, NexGuard also texts the reply.
  const texted = await textFinder(thread, tag, req.valid.body.text);
  res.json({ thread: thread.toOwner(), texted });
});

router.post('/threads/:id/close', idParams, async (req, res) => {
  const { thread } = await scopedThread(req);
  thread.status = 'closed';
  await thread.save();
  res.json({ thread: thread.toOwner() });
});

export default router;
