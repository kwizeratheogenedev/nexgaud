import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { devOutbox } from '../src/services/sms.js';
import { normalizePhone } from '../src/lib/phone.js';

let mongo;

export async function startDb() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await mongoose.connection.syncIndexes();
}

export async function stopDb() {
  await mongoose.disconnect();
  await mongo?.stop();
}

export async function clearDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  devOutbox.length = 0;
}

export const app = createApp();

export function lastCodeFor(phone) {
  const to = normalizePhone(phone);
  const sms = [...devOutbox].reverse().find((m) => m.to === to);
  return sms?.message.match(/\b(\d{6})\b/)?.[1];
}

/** Signs in through the real SMS-code flow and returns the tokens. */
export async function signIn(phone = '+250788000001', name = 'Test Owner') {
  await request(app).post('/api/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, code: lastCodeFor(phone), name });
  if (![200, 201].includes(res.status)) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Signs in, pairs a phone, and returns helpers for both sides. */
export async function ownerWithDevice(phone) {
  const session = await signIn(phone);
  const res = await request(app)
    .post('/api/v1/devices')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({ name: 'My Tecno', brand: 'TECNO', model: 'Spark 20' })
    .expect(201);
  return {
    ...session,
    device: res.body.device,
    deviceToken: res.body.deviceToken,
    owner: (req) => req.set('Authorization', `Bearer ${session.accessToken}`),
    phone: (req) => req.set('Authorization', `Device ${res.body.deviceToken}`),
  };
}
