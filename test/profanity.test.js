import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, signup } from './helpers.js';
import { censorExpletives, findSlur } from '../server/lib/profanity.js';

test('slurs are detected through common disguises', () => {
  for (const t of ['nigger', 'NIGGAS', 'n1gg3r', 'niiiigger', 'n i g g e r', 'n.i.g.g.e.r', 'n*gger', 'sandnigger', 'what a fag', 'faggots', 'you retard', 'tranny', 'kike', 'spics']) {
    assert.ok(findSlur(t), `should catch: ${t}`);
  }
});

test('ordinary words that contain slur letters are allowed', () => {
  for (const t of ['Niger is in West Africa', 'sniggering at the start line', 'a raccoon crossed the course', 'new spikes', 'fire retardant',
    'Japan Championships', 'Dickinson College', 'Scunthorpe', 'class pass assess', 'cockpit', 'Hancock', 'coonhound', 'spicy food', 'tardy to practice']) {
    assert.equal(findSlur(t), null, `false positive: ${t}`);
  }
});

test('expletives keep their consonants and lose their vowels', () => {
  assert.equal(censorExpletives('fuck'), 'f*ck');
  assert.equal(censorExpletives('What the FUCK was that pace'), 'What the F*CK was that pace');
  assert.equal(censorExpletives('fucking motherfucker'), 'f*cking m*th*rf*cker');
  assert.equal(censorExpletives('bullshit split'), 'bullsh*t split');
  assert.equal(censorExpletives('dumbass, asshole, bitch'), 'd*mb*ss, *ssh*l*, b*tch');
  assert.equal(censorExpletives('pissed off'), 'p*ss*d off');
  // Untouched lookalikes.
  for (const t of ['class assessment', 'Dickinson', 'Scunthorpe', 'cockpit', 'passion', 'shiitake', 'prickly pear']) {
    assert.equal(censorExpletives(t), t);
  }
});

let srv, a, admin;
before(async () => {
  srv = await startServer();
  a = await signup(srv.base, 'swearer@umich.edu');
  admin = await signup(srv.base, 'admin@example.com');
});
after(() => srv.close());

test('posts with slurs are refused everywhere', async () => {
  const r = await a.post('/api/posts', { board: 'general', body: 'that guy is a f4gg0t' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /slur/);
  const p = (await a.post('/api/posts', { board: 'general', body: 'clean post' })).data.post;
  assert.equal((await a.post(`/api/posts/${p.id}/comments`, { body: 'r e t a r d' })).status, 400);
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'poll', poll: ['fine', 'kike'] })).status, 400);
});

test('expletives are stored censored in posts, comments, polls, and chats', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'That last lap was fucking brutal', poll: ['hell yes', 'bullshit'] })).data.post;
  assert.equal(p.body, 'That last lap was f*cking brutal');
  assert.deepEqual(p.poll.options.map((o) => o.text), ['hell yes', 'bullsh*t']);
  const other = await signup(srv.base, 'other@wisc.edu');
  const c = (await other.post(`/api/posts/${p.id}/comments`, { body: 'no shit' })).data.comment;
  assert.equal(c.body, 'no sh*t');
  const chat = (await other.post('/api/chats', { postId: p.id })).data.chat;
  const m = (await other.post(`/api/chats/${chat.id}/messages`, { body: 'what the fuck' })).data.message;
  assert.equal(m.body, 'what the f*ck');
  assert.ok(!JSON.stringify(srv.db.prepare('SELECT body FROM posts').all()).includes('fucking'));
});

test('admins can turn expletive censoring off', async () => {
  await admin.put('/api/admin/settings', { censorExpletives: false });
  const p = (await a.post('/api/posts', { board: 'general', body: 'damn fuck' })).data.post;
  assert.equal(p.body, 'damn fuck');
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'nigga' })).status, 400, 'slurs stay blocked');
  await admin.put('/api/admin/settings', { censorExpletives: true });
});
