import fs from 'node:fs';
import path from 'node:path';
import { randomToken } from './crypto.js';
import { badRequest } from './errors.js';

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function detectType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'gif';
  return null;
}

// --- JPEG -----------------------------------------------------------------
// Drop every APPn segment except JFIF (APP0), ICC (APP2) and Adobe (APP14),
// plus comments. EXIF (APP1) is where phones put GPS coordinates and device
// serials, so it goes — except the orientation flag, which we re-emit in a
// minimal EXIF block so photos are not shown sideways.

function readExifOrientation(seg) {
  // seg: APP1 payload (after the length bytes)
  if (seg.toString('ascii', 0, 6) !== 'Exif\0\0') return null;
  const t = seg.subarray(6);
  if (t.length < 8) return null;
  const le = t.toString('ascii', 0, 2) === 'II';
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === 0x0112) return u16(e + 8);
    }
  } catch {
    return null;
  }
  return null;
}

function orientationSegment(o) {
  const b = Buffer.alloc(36);
  b.writeUInt16BE(0xffe1, 0);
  b.writeUInt16BE(34, 2);
  b.write('Exif\0\0', 4, 'ascii');
  b.write('MM', 10, 'ascii');
  b.writeUInt16BE(42, 12);
  b.writeUInt32BE(8, 14);
  b.writeUInt16BE(1, 18); // one entry
  b.writeUInt16BE(0x0112, 20);
  b.writeUInt16BE(3, 22); // SHORT
  b.writeUInt32BE(1, 24);
  b.writeUInt16BE(o, 28);
  b.writeUInt32BE(0, 32); // no next IFD
  return b;
}

export function stripJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  let orientation = null;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw badRequest('Corrupt JPEG.');
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      if (marker === 0xff) { i += 1; continue; }
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); break; }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded image data.
      if (orientation && orientation !== 1) {
        const afterJfif = out[1] && out[1][1] === 0xe0 ? 2 : 1;
        out.splice(afterJfif, 0, orientationSegment(orientation));
      }
      out.push(buf.subarray(i));
      return Buffer.concat(out);
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1) {
      orientation = orientation ?? readExifOrientation(seg.subarray(4));
    } else if (marker === 0xfe || (isApp && ![0xe0, 0xe2, 0xee].includes(marker))) {
      // drop comments and unknown APPn
    } else {
      out.push(seg);
    }
    i += 2 + len;
  }
  return Buffer.concat(out);
}

// --- PNG ------------------------------------------------------------------
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT']);

export function stripPng(buf) {
  const out = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw badRequest('Corrupt PNG.');
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

// --- WebP -----------------------------------------------------------------
export function stripWebp(buf) {
  const chunks = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > buf.length) throw badRequest('Corrupt WebP.');
    if (id !== 'EXIF' && id !== 'XMP ') chunks.push(Buffer.from(buf.subarray(i, Math.min(end, buf.length))));
    i = end;
  }
  for (const c of chunks) {
    if (c.toString('ascii', 0, 4) === 'VP8X') c[8] &= ~(0x08 | 0x04); // clear EXIF + XMP flags
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

export function sanitizeImage(buf) {
  const type = detectType(buf);
  if (!type) throw badRequest('Images must be JPEG, PNG, WebP, or GIF.');
  const clean = type === 'jpg' ? stripJpeg(buf) : type === 'png' ? stripPng(buf) : type === 'webp' ? stripWebp(buf) : buf;
  return { type, buffer: clean };
}

export function saveImage(uploadDir, buf) {
  const { type, buffer } = sanitizeImage(buf);
  fs.mkdirSync(uploadDir, { recursive: true });
  const name = `${randomToken(18)}.${type}`;
  fs.writeFileSync(path.join(uploadDir, name), buffer);
  return name;
}

export function deleteImage(uploadDir, name) {
  if (!name || name.includes('/') || name.includes('..')) return;
  fs.rm(path.join(uploadDir, name), { force: true }, () => {});
}
