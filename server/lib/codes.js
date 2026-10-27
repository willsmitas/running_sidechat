import config from '../config.js';
import { hashEmail, hashToken, randomCode, safeEqual } from './crypto.js';
import { badRequest } from './errors.js';
import { codeEmail, sendMail } from './mailer.js';

const TTL = 15 * 60_000;
const MAX_ATTEMPTS = 5;

const codeHash = (purpose, emailHash, code) => hashToken(`code:${purpose}:${emailHash}:${code}`);

export async function issueCode(db, { purpose, email, userId = null, data = null }) {
  const emailHash = hashEmail(email);
  const code = randomCode();
  const now = Date.now();
  db.prepare('DELETE FROM email_codes WHERE purpose = ? AND email_hash = ?').run(purpose, emailHash);
  db.prepare('INSERT INTO email_codes (purpose, email_hash, user_id, code_hash, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(purpose, emailHash, userId, codeHash(purpose, emailHash, code), data ? JSON.stringify(data) : null, now, now + TTL);
  const { subject, text } = codeEmail(code, purpose);
  await sendMail({ to: email, subject, text });
  return config.exposeDevCodes ? { devCode: code } : {};
}

export function consumeCode(db, { purpose, email, code, userId }) {
  const emailHash = hashEmail(email);
  const row = userId === undefined
    ? db.prepare('SELECT * FROM email_codes WHERE purpose = ? AND email_hash = ?').get(purpose, emailHash)
    : db.prepare('SELECT * FROM email_codes WHERE purpose = ? AND email_hash = ? AND user_id IS ?').get(purpose, emailHash, userId);
  if (!row || row.expires_at < Date.now()) throw badRequest('That code has expired. Request a new one.');
  if (row.attempts >= MAX_ATTEMPTS) throw badRequest('Too many wrong attempts. Request a new code.');
  const clean = String(code || '').replace(/\D/g, '');
  if (!safeEqual(codeHash(purpose, emailHash, clean), row.code_hash)) {
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw badRequest('That code is not right.');
  }
  db.prepare('DELETE FROM email_codes WHERE id = ?').run(row.id);
  return { emailHash, data: row.data ? JSON.parse(row.data) : null };
}
