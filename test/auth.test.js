import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, signup, sentMail, resetLimits } from './helpers.js';

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.close());

test('signup requires a valid code, then logs in', async () => {
  resetLimits();
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { email: 'Runner@Example.com', password: 'hunter22hunter', acceptRules: true });
  assert.equal(s.status, 200);
  assert.match(s.data.devCode, /^\d{6}$/);
  assert.ok(sentMail.at(-1).text.includes(s.data.devCode));

  const bad = await c.post('/api/auth/verify', { email: 'runner@example.com', code: '000000' === s.data.devCode ? '111111' : '000000' });
  assert.equal(bad.status, 400);

  const ok = await c.post('/api/auth/verify', { email: 'runner@example.com', code: s.data.devCode });
  assert.equal(ok.status, 200);
  const me = await c.get('/api/me');
  assert.equal(me.data.user.role, 'user');
  assert.equal(me.data.user.college, null);
});

test('emails are stored only as hashes', async () => {
  await signup(srv.base, 'private@example.com');
  const rows = srv.db.prepare('SELECT * FROM users').all();
  for (const r of rows) assert.ok(!JSON.stringify(r).includes('example.com'));
});

test('signup does not reveal existing accounts', async () => {
  resetLimits();
  await signup(srv.base, 'exists@example.com');
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { email: 'exists@example.com', password: 'whatever123', acceptRules: true });
  assert.equal(s.status, 200);
  assert.equal(s.data.devCode, undefined);
  assert.match(sentMail.at(-1).subject, /already have/);
});

test('login, logout, wrong password', async () => {
  resetLimits();
  await signup(srv.base, 'login@example.com', 'pass-word-123');
  const c = client(srv.base);
  assert.equal((await c.post('/api/auth/login', { email: 'login@example.com', password: 'nope-nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'LOGIN@example.com', password: 'pass-word-123' })).status, 200);
  assert.ok((await c.get('/api/me')).data.user);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).data.user, null);
});

test('password reset invalidates old sessions', async () => {
  resetLimits();
  const old = await signup(srv.base, 'reset@example.com', 'first-password');
  const c = client(srv.base);
  const f = await c.post('/api/auth/forgot', { email: 'reset@example.com' });
  assert.ok(f.data.devCode);
  const r = await c.post('/api/auth/reset', { email: 'reset@example.com', code: f.data.devCode, password: 'second-password' });
  assert.equal(r.status, 200);
  assert.equal((await old.get('/api/me')).data.user, null);
  assert.ok((await c.get('/api/me')).data.user);
  const again = client(srv.base);
  assert.equal((await again.post('/api/auth/login', { email: 'reset@example.com', password: 'second-password' })).status, 200);
});

test('ADMIN_EMAILS get the admin role', async () => {
  resetLimits();
  const a = await signup(srv.base, 'admin@example.com');
  assert.equal((await a.get('/api/me')).data.user.role, 'admin');
});

test('mutations without the CSRF header are rejected', async () => {
  const res = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: 'x' }),
  });
  assert.equal(res.status, 403);
});

test('code attempts are limited', async () => {
  resetLimits();
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { email: 'brute@example.com', password: 'longenough', acceptRules: true });
  const wrong = s.data.devCode === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await c.post('/api/auth/verify', { email: 'brute@example.com', code: wrong });
  const r = await c.post('/api/auth/verify', { email: 'brute@example.com', code: s.data.devCode });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Too many/);
});

test('account deletion with content purge', async () => {
  resetLimits();
  const c = await signup(srv.base, 'leaver@example.com', 'leaving-now');
  const p = await c.post('/api/posts', { board: 'general', body: 'goodbye cruel track' });
  assert.equal(p.status, 201);
  assert.equal((await c.post('/api/me/delete', { password: 'wrong' })).status, 400);
  assert.equal((await c.post('/api/me/delete', { password: 'leaving-now', deleteContent: true })).status, 200);
  const row = srv.db.prepare('SELECT * FROM posts WHERE id = ?').get(p.data.post.id);
  assert.equal(row.body, '');
  assert.ok(row.deleted_at);
  assert.equal(row.user_id, null);
});
