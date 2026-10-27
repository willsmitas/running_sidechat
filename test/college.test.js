import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, signup, resetLimits } from './helpers.js';

let srv;
let admin;
before(async () => { srv = await startServer(); admin = await signup(srv.base, 'admin@example.com'); });
after(() => srv.close());
beforeEach(() => resetLimits());

async function boardMap(c) {
  const { data } = await c.get('/api/boards');
  return Object.fromEntries(data.boards.map((b) => [b.slug, b]));
}

test('signing up with a school email verifies college automatically', async () => {
  const c = await signup(srv.base, 'miler@g.harvard.edu');
  assert.equal(c.verify.collegeVerified, true);
  const me = (await c.get('/api/me')).data.user;
  assert.equal(me.college.schoolName, 'Harvard');
  assert.equal(me.college.division, 1);
  assert.equal(me.college.conferenceShort, 'Ivy');

  const b = await boardMap(c);
  assert.equal(b.ncaa.canView, true);
  assert.equal(b.d1.canView, true);
  assert.equal(b['conf-ivy'].canView, true);
  assert.equal(b.d3.canView, false);
  assert.equal(b['conf-big-ten'].canView, false);
  assert.equal(b['conf-big-ten'].lockedReason, 'other');
  assert.equal(b.general.canView, true);
});

test('non-college users see private boards as locked', async () => {
  const c = await signup(srv.base, 'fan@gmail.com');
  const b = await boardMap(c);
  assert.equal(b.ncaa.canView, false);
  assert.equal(b.ncaa.lockedReason, 'verify');
  const feed = await c.get('/api/feed?board=ncaa');
  assert.equal(feed.status, 403);
  assert.equal(feed.data.locked, true);
  const post = await c.post('/api/posts', { board: 'ncaa', body: 'let me in' });
  assert.equal(post.status, 403);

  const anon = client(srv.base);
  assert.equal((await anon.get('/api/feed?board=conf-ivy')).status, 403);
  assert.equal((await anon.get('/api/feed?board=general')).status, 200);
});

test('verifying a college email after signup', async () => {
  const c = await signup(srv.base, 'later@gmail.com');
  const s = await c.post('/api/college/start', { email: 'later@stolaf.edu' });
  assert.equal(s.data.sent, true);
  const r = await c.post('/api/college/confirm', { email: 'later@stolaf.edu', code: s.data.devCode });
  assert.equal(r.status, 200);
  assert.equal(r.data.college.conferenceShort, 'MIAC');
  assert.equal(r.data.college.division, 3);
  const b = await boardMap(c);
  assert.equal(b.d3.canView, true);
  assert.equal(b['conf-miac'].canView, true);
  assert.equal(b.d1.canView, false);
});

test('one school email can only back one account', async () => {
  await signup(srv.base, 'unique@uoregon.edu');
  const c = await signup(srv.base, 'other@gmail.com');
  const s = await c.post('/api/college/start', { email: 'unique@uoregon.edu' });
  assert.equal(s.status, 400);
  assert.match(s.data.error, /already linked/);
});

test('shared domains ask the student to choose', async () => {
  const c = await signup(srv.base, 'mainer@gmail.com');
  const s = await c.post('/api/college/start', { email: 'student@maine.edu' });
  assert.equal(s.data.needsChoice, true);
  assert.ok(s.data.schools.length >= 3);
  const farm = s.data.schools.find((x) => x.name === 'UMaine Farmington');
  const bad = await c.post('/api/college/start', { email: 'student@maine.edu', schoolId: 1 });
  assert.equal(bad.data.needsChoice, true);
  const ok = await c.post('/api/college/start', { email: 'student@maine.edu', schoolId: farm.id });
  const r = await c.post('/api/college/confirm', { email: 'student@maine.edu', code: ok.data.devCode });
  assert.equal(r.data.college.schoolName, 'UMaine Farmington');
  assert.equal(r.data.college.conferenceShort, 'NAC');
});

test('unknown .edu domains go to manual review', async () => {
  const c = await signup(srv.base, 'newbie@gmail.com');
  const s1 = await c.post('/api/college/start', { email: 'me@weird-college.edu' });
  assert.equal(s1.data.needsManual, true);
  const school = (await c.get('/api/schools?q=Colorado%20State')).data.schools.find((x) => x.name === 'Colorado State');
  const s2 = await c.post('/api/college/start', { email: 'me@weird-college.edu', schoolId: school.id });
  assert.equal(s2.data.manual, true);
  const r = await c.post('/api/college/confirm', { email: 'me@weird-college.edu', code: s2.data.devCode });
  assert.equal(r.data.pending, true);
  assert.equal((await c.get('/api/me')).data.user.pendingCollege, 'Colorado State');
  assert.equal((await boardMap(c)).ncaa.canView, false);

  const list = await admin.get('/api/admin/verifications');
  const req = list.data.requests.find((x) => x.domain === 'weird-college.edu');
  assert.ok(req);
  assert.equal((await admin.post(`/api/admin/verifications/${req.id}`, { action: 'approve', addDomain: true })).status, 200);
  const b = await boardMap(c);
  assert.equal(b['conf-pac-12'].canView, true);

  // The domain is now known, so the next student is verified instantly.
  const next = await signup(srv.base, 'two@weird-college.edu');
  assert.equal(next.verify.collegeVerified, true);
});

test('non-academic domains are refused', async () => {
  const c = await signup(srv.base, 'nope@gmail.com');
  const s = await c.post('/api/college/start', { email: 'nope@yahoo.com' });
  assert.equal(s.status, 400);
});

test('expired verification removes access', async () => {
  const c = await signup(srv.base, 'grad@stanford.edu');
  srv.db.prepare('UPDATE college_verifications SET expires_at = ?').run(Date.now() - 1000);
  const b = await boardMap(c);
  assert.equal(b.ncaa.canView, false);
  assert.equal(b.ncaa.lockedReason, 'expired');
  srv.db.prepare('UPDATE college_verifications SET expires_at = ?').run(Date.now() + 86400_000);
});

test('moving a school to another conference moves access', async () => {
  const c = await signup(srv.base, 'mover@gonzaga.edu');
  assert.equal((await boardMap(c))['conf-pac-12'].canView, true);
  const s = (await admin.get('/api/admin/schools?q=Gonzaga')).data.schools[0];
  const wcc = (await admin.get('/api/admin/conferences')).data.conferences.find((x) => x.slug === 'wcc');
  await admin.patch(`/api/admin/schools/${s.id}`, { conferenceId: wcc.id });
  const b = await boardMap(c);
  assert.equal(b['conf-pac-12'].canView, false);
  assert.equal(b['conf-wcc'].canView, true);
});

test('conference directory lists every division', async () => {
  const { data } = await client(srv.base).get('/api/conferences');
  const divs = new Set(data.conferences.map((c) => c.division));
  assert.deepEqual([...divs].sort(), [1, 2, 3]);
  assert.ok(data.conferences.length > 90);
  assert.ok(data.conferences.find((c) => c.slug === 'sec').schools.includes('Arkansas'));
});
