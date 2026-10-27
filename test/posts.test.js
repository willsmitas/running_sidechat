import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, signup, resetLimits } from './helpers.js';

let srv, a, b, c, admin;
before(async () => {
  srv = await startServer();
  a = await signup(srv.base, 'a@umich.edu');
  b = await signup(srv.base, 'b@wisc.edu');
  c = await signup(srv.base, 'c@gmail.com');
  admin = await signup(srv.base, 'admin@example.com');
});
after(() => srv.close());
beforeEach(() => resetLimits());

test('create, read, and list posts', async () => {
  const p = await a.post('/api/posts', { board: 'conf-big-ten', body: 'Who wins B1G XC this year?' });
  assert.equal(p.status, 201);
  assert.equal(p.data.post.score, 1);
  assert.equal(p.data.post.myVote, 1);
  assert.equal(p.data.post.isMine, true);
  assert.equal(p.data.post.author.isOp, true);

  const feed = await b.get('/api/feed?board=conf-big-ten&sort=new');
  assert.ok(feed.data.posts.some((x) => x.id === p.data.post.id && x.isMine === false));
  const home = await b.get('/api/feed');
  assert.ok(home.data.posts.some((x) => x.id === p.data.post.id));
  const homeC = await c.get('/api/feed');
  assert.ok(!homeC.data.posts.some((x) => x.id === p.data.post.id), 'private posts stay out of non-members home feed');
  assert.equal((await c.get(`/api/posts/${p.data.post.id}`)).status, 403);
  // Posts never expose who wrote them.
  assert.ok(!JSON.stringify(feed.data).includes('user_id'));
});

test('per-thread anonymous aliases', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'Thread for aliases' })).data.post;
  const c1 = (await b.post(`/api/posts/${p.id}/comments`, { body: 'first' })).data.comment;
  const c2 = (await c.post(`/api/posts/${p.id}/comments`, { body: 'second' })).data.comment;
  const c3 = (await b.post(`/api/posts/${p.id}/comments`, { body: 'third', parentId: c2.id })).data.comment;
  const c4 = (await a.post(`/api/posts/${p.id}/comments`, { body: 'op reply' })).data.comment;
  assert.equal(c1.author.idx, c3.author.idx);
  assert.notEqual(c1.author.idx, c2.author.idx);
  assert.equal(c4.author.isOp, true);
  assert.equal(c4.author.name, 'OP');
  assert.equal(c3.parentId, c2.id);

  const detail = (await c.get(`/api/posts/${p.id}`)).data;
  assert.equal(detail.comments.length, 4);
  assert.equal(detail.me.idx, c2.author.idx);
  assert.equal(detail.post.commentCount, 4);
});

test('voting updates scores and is idempotent', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'vote on me' })).data.post;
  assert.equal((await b.post(`/api/posts/${p.id}/vote`, { value: 1 })).data.score, 2);
  assert.equal((await b.post(`/api/posts/${p.id}/vote`, { value: 1 })).data.score, 2);
  assert.equal((await b.post(`/api/posts/${p.id}/vote`, { value: -1 })).data.score, 0);
  assert.equal((await b.post(`/api/posts/${p.id}/vote`, { value: 0 })).data.score, 1);
  assert.equal((await b.post(`/api/posts/${p.id}/vote`, { value: 5 })).status, 400);
  // Non-members can't vote in private boards.
  const priv = (await a.post('/api/posts', { board: 'ncaa', body: 'private vote' })).data.post;
  assert.equal((await c.post(`/api/posts/${priv.id}/vote`, { value: 1 })).status, 403);
});

test('polls hide results until you vote', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'Best distance?', poll: ['1500', '5k', '10k'] })).data.post;
  assert.equal(p.poll.options.length, 3);
  const before = (await b.get(`/api/posts/${p.id}`)).data.post.poll;
  assert.equal(before.total, null);
  const r = await b.post(`/api/posts/${p.id}/poll`, { optionId: before.options[1].id });
  assert.equal(r.data.poll.total, 1);
  assert.equal(r.data.poll.options[1].votes, 1);
  assert.equal((await b.post(`/api/posts/${p.id}/poll`, { optionId: before.options[0].id })).status, 400);
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'bad', poll: ['only one'] })).status, 400);
});

test('content guard blocks contact info but not race times', async () => {
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'email me coach@school.edu' })).status, 400);
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'call 617-555-0199' })).status, 400);
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'ran 3:59.41 then 13:45.22, splits 64-66-65' })).status, 201);
  assert.equal((await a.post('/api/posts', { board: 'general', body: '   ' })).status, 400);
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'x'.repeat(2001) })).status, 400);
});

test('flair shows division or conference, never school', async () => {
  const p = (await a.post('/api/posts', { board: 'ncaa', body: 'flair test', flair: 'conference' })).data.post;
  assert.equal(p.flair, 'DI · Big Ten');
  assert.equal((await a.post('/api/posts', { board: 'conf-big-ten', body: 'x', flair: 'conference' })).status, 400);
  assert.equal((await c.post('/api/posts', { board: 'general', body: 'x', flair: 'division' })).status, 400);
  const d = (await a.post('/api/posts', { board: 'general', body: 'public flair', flair: 'division' })).data.post;
  assert.equal(d.flair, 'DI');
});

test('sorting: new, top, hot, active', async () => {
  for (const s of ['hot', 'new', 'top', 'active']) {
    const r = await c.get(`/api/feed?board=general&sort=${s}&t=all`);
    assert.equal(r.status, 200);
    assert.ok(r.data.posts.length > 0);
  }
  const top = (await c.get('/api/feed?board=general&sort=top&t=all')).data.posts;
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].score >= top[i].score);
});

test('notifications for comments and replies', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'notify me please' })).data.post;
  const cm = (await b.post(`/api/posts/${p.id}/comments`, { body: 'hello op' })).data.comment;
  await c.post(`/api/posts/${p.id}/comments`, { body: 'hi b', parentId: cm.id });
  const na = (await a.get('/api/notifications')).data.notifications;
  const mine = na.filter((n) => n.postId === p.id);
  assert.equal(mine.length, 1, 'collapsed into one notification');
  assert.equal(mine[0].count, 2);
  const nb = (await b.get('/api/notifications')).data.notifications;
  assert.ok(nb.some((n) => n.type === 'reply' && n.postId === p.id));
  assert.ok((await a.get('/api/me')).data.user.unread.notifications >= 1);
  await a.post('/api/notifications/read');
  assert.equal((await a.get('/api/me')).data.user.unread.notifications, 0);

  // Muting a thread stops notifications.
  await a.post(`/api/posts/${p.id}/follow`, { on: false });
  await c.post(`/api/posts/${p.id}/comments`, { body: 'more' });
  assert.equal((await a.get('/api/me')).data.user.unread.notifications, 0);
});

test('save, hide, delete', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'save me' })).data.post;
  await b.post(`/api/posts/${p.id}/save`, { on: true });
  assert.ok((await b.get('/api/me/saved')).data.posts.some((x) => x.id === p.id));
  await b.post(`/api/posts/${p.id}/hide`, { on: true });
  assert.ok(!(await b.get('/api/feed?board=general&sort=new')).data.posts.some((x) => x.id === p.id));
  assert.equal((await b.del(`/api/posts/${p.id}`)).status, 403);
  assert.equal((await a.del(`/api/posts/${p.id}`)).status, 200);
  assert.equal((await c.get(`/api/posts/${p.id}`)).status, 404);
});

test('comment deletion leaves a placeholder only when it has replies', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'deletions' })).data.post;
  const top = (await b.post(`/api/posts/${p.id}/comments`, { body: 'parent' })).data.comment;
  await c.post(`/api/posts/${p.id}/comments`, { body: 'child', parentId: top.id });
  const lone = (await b.post(`/api/posts/${p.id}/comments`, { body: 'lonely' })).data.comment;
  await b.del(`/api/comments/${top.id}`);
  await b.del(`/api/comments/${lone.id}`);
  const list = (await c.get(`/api/posts/${p.id}`)).data.comments;
  assert.equal(list.length, 2);
  const placeholder = list.find((x) => x.id === top.id);
  assert.equal(placeholder.deleted, true);
  assert.equal(placeholder.body, '');
  assert.equal(placeholder.author, null);
});

test('search finds posts the viewer can see', async () => {
  await a.post('/api/posts', { board: 'general', body: 'Thoughts on the Bowerman Track Club workouts' });
  await a.post('/api/posts', { board: 'conf-big-ten', body: 'Bowerman secret conference post' });
  const r = await c.get('/api/search?q=bowerman');
  assert.equal(r.status, 200);
  assert.equal(r.data.posts.length, 1);
  const r2 = await b.get('/api/search?q=bowerm');
  assert.equal(r2.data.posts.length, 2);
});

test('reports auto-hide content and admins can review', async () => {
  const p = (await c.post('/api/posts', { board: 'general', body: 'something reportable' })).data.post;
  const reporters = [a, b, await signup(srv.base, 'd@gmail.com')];
  for (const r of reporters) assert.equal((await r.post('/api/reports', { kind: 'post', id: p.id, reason: 'harassment' })).status, 200);
  // duplicate reports are ignored
  await a.post('/api/reports', { kind: 'post', id: p.id, reason: 'spam' });
  assert.ok(!(await b.get('/api/feed?board=general&sort=new')).data.posts.some((x) => x.id === p.id));
  // The author still sees it, flagged as removed.
  assert.equal((await c.get(`/api/posts/${p.id}`)).data.post.removed, true);

  const q = (await admin.get('/api/admin/reports')).data.reports;
  const item = q.find((x) => x.kind === 'post' && x.targetId === p.id);
  assert.equal(item.count, 3);
  await admin.post('/api/admin/reports/resolve', { kind: 'post', id: p.id, action: 'dismiss' });
  assert.ok((await b.get('/api/feed?board=general&sort=new')).data.posts.some((x) => x.id === p.id));

  await admin.post('/api/admin/remove', { kind: 'post', id: p.id, reason: 'Rule 1' });
  assert.equal((await b.get(`/api/posts/${p.id}`)).status, 404);
  assert.ok((await c.get('/api/notifications')).data.notifications.some((n) => n.type === 'removed'));
  assert.ok((await admin.get('/api/admin/log')).data.log.some((l) => l.action === 'remove'));
});

test('regular users cannot reach admin endpoints', async () => {
  assert.equal((await a.get('/api/admin/stats')).status, 403);
  assert.equal((await client(srv.base).get('/api/admin/stats')).status, 403);
  assert.equal((await admin.get('/api/admin/stats')).status, 200);
});

test('bans block posting and expire', async () => {
  const victim = await signup(srv.base, 'troll@gmail.com');
  const p = (await victim.post('/api/posts', { board: 'general', body: 'troll post' })).data.post;
  const author = (await admin.get(`/api/posts/${p.id}`)).data.post.mod.authorId;
  await admin.post(`/api/admin/users/${author}/ban`, { days: 3, reason: 'trolling', purge: true });
  const r = await victim.post('/api/posts', { board: 'general', body: 'again' });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /suspended/);
  assert.equal((await b.get(`/api/posts/${p.id}`)).status, 404);
  await admin.post(`/api/admin/users/${author}/unban`);
  assert.equal((await victim.post('/api/posts', { board: 'general', body: 'reformed' })).status, 201);
});

test('locked threads refuse comments; pinned posts float', async () => {
  const p = (await a.post('/api/posts', { board: 'training', body: 'Board rules' })).data.post;
  await a.post('/api/posts', { board: 'training', body: 'newer post' });
  await admin.post(`/api/posts/${p.id}/pin`, { on: true });
  await admin.post(`/api/posts/${p.id}/lock`, { on: true });
  const feed = (await c.get('/api/feed?board=training&sort=new')).data.posts;
  assert.equal(feed[0].id, p.id);
  assert.equal(feed[0].pinned, true);
  assert.equal((await c.post(`/api/posts/${p.id}/comments`, { body: 'hi' })).status, 403);
});

test('admin can manage boards and settings', async () => {
  const nb = await admin.post('/api/admin/boards', { slug: 'trail', name: 'Trail & Ultra', emoji: '⛰️', description: 'Dirt.' });
  assert.equal(nb.status, 201);
  assert.ok((await c.get('/api/boards')).data.boards.some((x) => x.slug === 'trail'));
  await admin.patch(`/api/admin/boards/${nb.data.board.id}`, { archived: true });
  assert.ok(!(await c.get('/api/boards')).data.boards.some((x) => x.slug === 'trail'));
  assert.equal((await admin.post('/api/admin/boards', { slug: 'conf-fake', name: 'x' })).status, 400);

  await admin.put('/api/admin/settings', { bannedWords: 'forbiddenword', announcement: 'Welcome!' });
  assert.equal((await a.post('/api/posts', { board: 'general', body: 'a ForbiddenWord here' })).status, 400);
  assert.equal((await client(srv.base).get('/api/me')).data.site.announcement, 'Welcome!');
});

test('anonymous chats keep thread identities', async () => {
  const p = (await a.post('/api/posts', { board: 'general', body: 'DM me about pacing' })).data.post;
  const start = await b.post('/api/chats', { postId: p.id });
  assert.equal(start.status, 201);
  const chat = start.data.chat;
  assert.equal(chat.them.isOp, true);
  assert.equal((await b.post('/api/chats', { postId: p.id })).data.chat.id, chat.id, 'reuses the conversation');
  assert.equal((await a.post('/api/chats', { postId: p.id })).status, 400, 'cannot chat yourself');

  await b.post(`/api/chats/${chat.id}/messages`, { body: 'what splits for 4:00?' });
  assert.equal((await a.get('/api/me')).data.user.unread.chats, 1);
  const list = (await a.get('/api/chats')).data.chats;
  assert.equal(list[0].id, chat.id);
  assert.equal(list[0].me.isOp, true);
  const msgs = (await a.get(`/api/chats/${chat.id}`)).data.messages;
  assert.equal(msgs[0].body, 'what splits for 4:00?');
  assert.equal(msgs[0].mine, false);
  assert.equal((await a.get('/api/me')).data.user.unread.chats, 0);

  // A third person can't read it.
  assert.equal((await c.get(`/api/chats/${chat.id}`)).status, 404);

  await a.post(`/api/chats/${chat.id}/block`, { on: true });
  assert.equal((await b.post(`/api/chats/${chat.id}/messages`, { body: 'hello?' })).status, 403);
  // Messages can be reported.
  assert.equal((await a.post('/api/reports', { kind: 'message', id: msgs[0].id, reason: 'harassment' })).status, 200);
  assert.equal((await c.post('/api/reports', { kind: 'message', id: msgs[0].id, reason: 'harassment' })).status, 404);
});

test('karma sums scores', async () => {
  const me = (await a.get('/api/me')).data.user;
  assert.ok(me.karma > 0);
});
