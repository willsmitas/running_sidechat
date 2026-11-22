import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, signup, client } from './helpers.js';
import { setGiphyFetch } from '../server/lib/giphy.js';

// Minimal JPEG with an EXIF segment carrying fake GPS text.
function jpegWithGps() {
  const seg = (m, payload) => {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(0xff00 | m, 0);
    h.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([h, payload]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe1, Buffer.from('Exif\0\0GPS 40.7N 74.0W', 'binary')),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0xd9]),
  ]);
}

const GIFS = {
  abcde12345: { id: 'abcde12345', rating: 'g', title: 'runner' },
  spicy99999: { id: 'spicy99999', rating: 'r', title: 'nope' },
  later77777: { id: 'later77777', rating: 'pg', title: 'not from search' },
};
const giphyCalls = [];
function fakeGiphy(url) {
  giphyCalls.push(url);
  const u = new URL(url);
  const asGif = (g) => ({ ...g, images: { fixed_width: { url: `https://media.giphy.com/media/${g.id}/200w.gif`, width: '200', height: '150' } } });
  let body;
  if (u.pathname.endsWith('/search') || u.pathname.endsWith('/trending')) body = { data: Object.values(GIFS).slice(0, 2).map(asGif) };
  else {
    const g = GIFS[u.pathname.split('/').pop()];
    if (!g) return Promise.resolve(new Response('{}', { status: 404 }));
    body = { data: asGif(g) };
  }
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

let srv, a, b, post;
before(async () => {
  setGiphyFetch(fakeGiphy);
  srv = await startServer();
  a = await signup(srv.base, 'media-a@gmail.com');
  b = await signup(srv.base, 'media-b@gmail.com');
  post = (await a.post('/api/posts', { board: 'general', body: 'reply with pics' })).data.post;
});
after(() => srv.close());

test('comments can carry an uploaded image, stripped of metadata', async () => {
  const fd = new FormData();
  fd.append('body', 'look at this course');
  fd.append('image', new Blob([jpegWithGps()], { type: 'image/jpeg' }), 'IMG_1.jpg');
  const r = await b.post(`/api/posts/${post.id}/comments`, fd);
  assert.equal(r.status, 201);
  assert.match(r.data.comment.image, /^\/uploads\/[\w-]+\.jpg$/);
  const file = path.join(process.env.DATA_DIR, 'uploads', path.basename(r.data.comment.image));
  assert.ok(!fs.readFileSync(file).toString('binary').includes('GPS'));
  const detail = (await a.get(`/api/posts/${post.id}`)).data;
  assert.equal(detail.comments.find((c) => c.id === r.data.comment.id).image, r.data.comment.image);
});

test('an image alone is enough, but an empty comment is not', async () => {
  const fd = new FormData();
  fd.append('image', new Blob([jpegWithGps()], { type: 'image/jpeg' }), 'x.jpg');
  const r = await b.post(`/api/posts/${post.id}/comments`, fd);
  assert.equal(r.status, 201);
  assert.equal(r.data.comment.body, '');
  assert.equal((await b.post(`/api/posts/${post.id}/comments`, { body: '  ' })).status, 400);
  const notes = (await a.get('/api/notifications')).data.notifications;
  assert.ok(notes.some((n) => n.text.includes('[image]') || n.count > 1));
});

test('GIF search goes through the server with the key hidden', async () => {
  const r = await b.get('/api/gifs/search?q=running');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.gifs.map((g) => g.id), ['abcde12345'], 'R-rated results are filtered out');
  assert.ok(!JSON.stringify(r.data).includes('test-giphy-key'));
  assert.ok(giphyCalls.at(-1).includes('rating=pg-13'));
  assert.equal((await client(srv.base).get('/api/gifs/search?q=x')).status, 401);
  assert.equal((await client(srv.base).get('/api/me')).data.site.gifs, true);
});

test('comments can carry a GIPHY GIF', async () => {
  const r = await b.post(`/api/posts/${post.id}/comments`, { body: 'me after the last 400', gifId: 'abcde12345' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.comment.gif, { id: 'abcde12345', url: 'https://media.giphy.com/media/abcde12345/giphy.gif' });
  // An id we never served is looked up on GIPHY before it's accepted.
  const later = await b.post(`/api/posts/${post.id}/comments`, { gifId: 'later77777' });
  assert.equal(later.status, 201);
  assert.equal(later.data.comment.body, '');
});

test('bad GIFs and double attachments are refused', async () => {
  assert.equal((await b.post(`/api/posts/${post.id}/comments`, { gifId: 'spicy99999' })).status, 400);
  assert.equal((await b.post(`/api/posts/${post.id}/comments`, { gifId: 'doesnotexist1' })).status, 400);
  assert.equal((await b.post(`/api/posts/${post.id}/comments`, { gifId: '../../evil' })).status, 400);
  const fd = new FormData();
  fd.append('gifId', 'abcde12345');
  fd.append('image', new Blob([jpegWithGps()], { type: 'image/jpeg' }), 'x.jpg');
  assert.equal((await b.post(`/api/posts/${post.id}/comments`, fd)).status, 400);
});

test('deleting a comment removes its image', async () => {
  const fd = new FormData();
  fd.append('image', new Blob([jpegWithGps()], { type: 'image/jpeg' }), 'x.jpg');
  const c = (await b.post(`/api/posts/${post.id}/comments`, fd)).data.comment;
  const file = path.join(process.env.DATA_DIR, 'uploads', path.basename(c.image));
  assert.ok(fs.existsSync(file));
  await b.del(`/api/comments/${c.id}`);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(file));
  const row = srv.db.prepare('SELECT image, gif FROM comments WHERE id = ?').get(c.id);
  assert.equal(row.image, null);
});
