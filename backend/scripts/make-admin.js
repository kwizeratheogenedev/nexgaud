/**
 * Gives a NexGuard team member access to the pilot statistics.
 *   npm run make-admin -- 0788123456          (they must have signed in once)
 *   npm run make-admin -- 0788123456 --remove
 * Uses MONGODB_URI from .env.
 */
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { User } from '../src/models/User.js';
import { normalizePhone } from '../src/lib/phone.js';

const [input, flag] = process.argv.slice(2);
const phone = normalizePhone(input ?? '');
if (!phone) {
  console.error('Usage: npm run make-admin -- <phone number> [--remove]');
  process.exit(1);
}

await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
const role = flag === '--remove' ? 'owner' : 'admin';
const user = await User.findOneAndUpdate({ phone }, { role }, { new: true });
if (!user) {
  console.error(`No account for ${phone}. Sign in once with that number, then run this again.`);
  process.exitCode = 1;
} else {
  console.log(`${phone} is now ${role === 'admin' ? 'an admin' : 'a normal owner'}.`);
}
await mongoose.disconnect();
