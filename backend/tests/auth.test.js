import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, clearDb, lastCodeFor, signIn, startDb, stopDb } from './helpers.js';
import { OtpCode } from '../src/models/OtpCode.js';
import { normalizePhone } from '../src/lib/phone.js';

before(startDb);
after(stopDb);
beforeEach(clearDb);

describe('phone numbers', () => {
  test('local Rwandan numbers become E.164', () => {
    assert.equal(normalizePhone('0788 123 456'), '+250788123456');
    assert.equal(normalizePhone('+250-788-123-456'), '+250788123456');
    assert.equal(normalizePhone('00250788123456'), '+250788123456');
    assert.equal(normalizePhone('12'), null);
    assert.equal(normalizePhone('abc'), null);
  });
});

describe('sign-in with an SMS code', () => {
  test('a new phone number gets an account and tokens', async () => {
    const body = await signIn('0788111222', 'Aline');
    assert.equal(body.isNew, true);
    assert.equal(body.user.phone, '+250788111222');
    assert.equal(body.user.name, 'Aline');
    assert.ok(body.accessToken && body.refreshToken);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${body.accessToken}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.phone, '+250788111222');
  });

  test('signing in again returns the same account', async () => {
    const first = await signIn('+250788111222');
    // Let the resend wait pass.
    await OtpCode.deleteMany({});
    const second = await signIn('+250788111222');
    assert.equal(second.isNew, false);
    assert.equal(second.user.id, first.user.id);
  });

  test('the code is never returned in the response or stored in plain text', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+250788111222' });
    const code = lastCodeFor('+250788111222');
    assert.ok(!JSON.stringify(res.body).includes(code));
    const stored = await OtpCode.findOne({ phone: '+250788111222' }).lean();
    assert.ok(!JSON.stringify(stored).includes(code));
  });

  test('an invalid phone number is rejected', async () => {
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone: '12' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'validation_failed');
  });

  test('a second code within a minute is refused', async () => {
    await request(app).post('/api/v1/auth/otp/request').send({ phone: '+250788111222' }).expect(200);
    const res = await request(app).post('/api/v1/auth/otp/request').send({ phone: '+250788111222' });
    assert.equal(res.status, 429);
  });

  test('wrong codes are counted and lock the code after 5 tries', async () => {
    const phone = '+250788111222';
    await request(app).post('/api/v1/auth/otp/request').send({ phone }).expect(200);
    const right = lastCodeFor(phone);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: wrong });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'code_invalid');
    }
    const locked = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: right });
    assert.equal(locked.status, 429);
  });

  test('a code works only once', async () => {
    const phone = '+250788111222';
    await request(app).post('/api/v1/auth/otp/request').send({ phone }).expect(200);
    const code = lastCodeFor(phone);
    await request(app).post('/api/v1/auth/otp/verify').send({ phone, code }).expect(201);
    const again = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, 'code_expired');
  });
});

describe('tokens', () => {
  test('a refresh token issues a new access token, by body or by cookie', async () => {
    const phone = '+250788111222';
    await request(app).post('/api/v1/auth/otp/request').send({ phone });
    const login = await request(app).post('/api/v1/auth/otp/verify').send({ phone, code: lastCodeFor(phone) });

    const byBody = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
    assert.equal(byBody.status, 200);
    assert.ok(byBody.body.accessToken);

    const cookie = login.headers['set-cookie'].find((c) => c.startsWith('nexguard_rt='));
    assert.match(cookie, /HttpOnly/i);
    const byCookie = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie.split(';')[0]);
    assert.equal(byCookie.status, 200);
  });

  test('an access token cannot be used as a refresh token, or the reverse', async () => {
    const s = await signIn();
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: s.accessToken });
    assert.equal(r1.status, 401);
    const r2 = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${s.refreshToken}`);
    assert.equal(r2.status, 401);
  });

  test('logging out everywhere invalidates old refresh tokens', async () => {
    const s = await signIn();
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken, everywhere: true }).expect(204);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    assert.equal(res.status, 401);
  });
});
