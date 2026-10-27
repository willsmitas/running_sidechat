import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, signup } from './helpers.js';
import { sanitizeImage, stripJpeg, stripPng } from '../server/lib/images.js';

function seg(marker, payload) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(0xff00 | marker, 0);
  b.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([b, payload]);
}

function exifWithOrientation(o) {
  // Exif header + big-endian TIFF with two IFD0 entries: Orientation and a
  // fake GPS-ish ASCII tag that must not survive.
  const tiff = Buffer.alloc(8 + 2 + 24 + 4);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(2, 8);
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(o, 18);
  tiff.writeUInt16BE(0x8825, 22); tiff.writeUInt16BE(4, 24); tiff.writeUInt32BE(1, 26); tiff.writeUInt32BE(0, 30);
  return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff, Buffer.from('GPS 42.3601N 71.0589W iPhone serial ABC123')]);
}

function fakeJpeg(orientation = 6) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')),
    seg(0xe1, exifWithOrientation(orientation)),
    seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>location</x:xmpmeta>')),
    seg(0xfe, Buffer.from('comment: taken at my house')),
    seg(0xdb, Buffer.alloc(65, 1)),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

test('JPEG metadata is stripped but orientation is kept', () => {
  const out = stripJpeg(fakeJpeg(6));
  const s = out.toString('binary');
  assert.ok(!s.includes('GPS'));
  assert.ok(!s.includes('serial'));
  assert.ok(!s.includes('xmpmeta'));
  assert.ok(!s.includes('my house'));
  assert.ok(s.includes('JFIF'));
  assert.ok(s.includes('Exif\0\0'));
  // Orientation tag survives with value 6.
  const i = out.indexOf(Buffer.from([0x01, 0x12, 0x00, 0x03]));
  assert.ok(i > 0);
  assert.equal(out.readUInt16BE(i + 8), 6);
  // Image data is untouched.
  assert.ok(out.includes(Buffer.from([0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9])));
  // Orientation 1 needs no EXIF at all.
  assert.ok(!stripJpeg(fakeJpeg(1)).toString('binary').includes('Exif'));
});

function pngChunk(type, data) {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'ascii');
  return Buffer.concat([b, data, Buffer.alloc(4)]);
}

test('PNG text and EXIF chunks are stripped', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('tEXt', Buffer.from('Author\0Secret Name')),
    pngChunk('eXIf', Buffer.from('gps')),
    pngChunk('IDAT', Buffer.from('pixels')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const s = stripPng(png).toString('binary');
  assert.ok(!s.includes('Secret'));
  assert.ok(!s.includes('eXIf'));
  assert.ok(s.includes('IDAT') && s.includes('IEND'));
});

test('non-images are rejected', () => {
  assert.throws(() => sanitizeImage(Buffer.from('<svg onload=alert(1)>')), /JPEG, PNG/);
});

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.close());

test('uploading an image with a post', async () => {
  const c = await signup(srv.base, 'photo@gmail.com');
  const fd = new FormData();
  fd.append('board', 'general');
  fd.append('body', 'check my spikes');
  fd.append('image', new Blob([fakeJpeg(6)], { type: 'image/jpeg' }), 'IMG_0001.jpg');
  const r = await c.post('/api/posts', fd);
  assert.equal(r.status, 201);
  assert.match(r.data.post.image, /^\/uploads\/[\w-]+\.jpg$/);
  const file = path.join(process.env.DATA_DIR, 'uploads', path.basename(r.data.post.image));
  assert.ok(!fs.readFileSync(file).toString('binary').includes('GPS'));
  const img = await fetch(srv.base + r.data.post.image);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');

  const bad = new FormData();
  bad.append('board', 'general');
  bad.append('body', 'not an image');
  bad.append('image', new Blob(['hello']), 'x.jpg');
  assert.equal((await c.post('/api/posts', bad)).status, 400);
});
