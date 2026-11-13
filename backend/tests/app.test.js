import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

test('health reports degraded when the database is not connected', async () => {
  const res = await request(app).get('/api/v1/health');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'degraded');
  assert.equal(res.body.db, 'disconnected');
  assert.ok(res.body.startedAt);
  assert.match(res.body.version, /^\d+\.\d+\.\d+$/);
  assert.notEqual(res.body.version, '0.0.0');
});

test('unknown routes return a JSON 404', async () => {
  const res = await request(app).get('/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});

test('security headers are set', async () => {
  const res = await request(app).get('/api/v1/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.ok(res.headers['x-content-type-options']);
});

test('malformed JSON bodies get a 400, not a 500', async () => {
  const res = await request(app)
    .post('/api/v1/health')
    .set('Content-Type', 'application/json')
    .send('{bad json');
  assert.equal(res.status, 400);
});
