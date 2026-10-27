import { Router } from 'express';
import config from '../config.js';
import { tx } from '../db.js';
import { hashEmail, hashPassword, isValidEmail, normalizeEmail, verifyPassword } from '../lib/crypto.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { hit } from '../lib/ratelimit.js';
import { consumeCode, issueCode } from '../lib/codes.js';
import { sendMail } from '../lib/mailer.js';
import { createSession, destroySession, requireUser } from '../lib/session.js';
import { emailDomain, schoolsForDomain } from '../lib/college.js';
import { grantCollege } from './college.js';

function readEmail(body) {
  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email)) throw badRequest('Enter a valid email address.');
  return email;
}

function readPassword(pw) {
  const p = String(pw ?? '');
  if (p.length < 8) throw badRequest('Passwords must be at least 8 characters.');
  if (p.length > 200) throw badRequest('That password is too long.');
  return p;
}

export default function authRoutes(db) {
  const r = Router();

  r.post('/signup', async (req, res) => {
    const email = readEmail(req.body);
    const password = readPassword(req.body.password);
    if (!req.body.acceptRules) throw badRequest('You need to agree to the community rules.');
    hit(`signup:ip:${req.ip}`, 10, 3600_000);
    hit(`signup:email:${hashEmail(email)}`, 5, 3600_000);
    const exists = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(hashEmail(email));
    if (exists) {
      // Don't reveal that the account exists; tell the owner instead.
      await sendMail({
        to: email,
        subject: `You already have a ${config.appName} account`,
        text: `Someone tried to sign up with this email, but you already have an account. Log in, or reset your password if you forgot it.`,
      });
      return res.json({ ok: true });
    }
    const out = await issueCode(db, { purpose: 'signup', email, data: { passwordHash: hashPassword(password) } });
    res.json({ ok: true, ...out });
  });

  r.post('/verify', async (req, res) => {
    const email = readEmail(req.body);
    hit(`verify:ip:${req.ip}`, 30, 3600_000);
    const { emailHash, data } = consumeCode(db, { purpose: 'signup', email, code: req.body.code });
    const role = config.adminEmails.includes(email) ? 'admin' : 'user';
    const userId = tx(db, () => {
      const existing = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(emailHash);
      if (existing) return existing.id;
      return Number(db.prepare('INSERT INTO users (email_hash, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
        .run(emailHash, data.passwordHash, role, Date.now()).lastInsertRowid);
    });

    // Signing up with a school email verifies the college at the same time.
    let college = null;
    const { schools } = schoolsForDomain(db, emailDomain(email));
    if (schools.length === 1) {
      college = grantCollege(db, { userId, schoolId: schools[0].id, emailHash, silentIfTaken: true });
    }
    createSession(db, res, userId);
    res.json({ ok: true, collegeVerified: !!college, collegeChoices: schools.length > 1 ? schools : null });
  });

  r.post('/resend', async (req, res) => {
    const email = readEmail(req.body);
    hit(`resend:ip:${req.ip}`, 10, 3600_000);
    hit(`resend:email:${hashEmail(email)}`, 3, 900_000);
    const row = db.prepare("SELECT data FROM email_codes WHERE purpose = 'signup' AND email_hash = ?").get(hashEmail(email));
    if (!row) throw badRequest('Start sign up again — that request expired.');
    const out = await issueCode(db, { purpose: 'signup', email, data: JSON.parse(row.data) });
    res.json({ ok: true, ...out });
  });

  r.post('/login', (req, res) => {
    const email = readEmail(req.body);
    hit(`login:ip:${req.ip}`, 30, 900_000);
    hit(`login:email:${hashEmail(email)}`, 10, 900_000);
    const user = db.prepare('SELECT * FROM users WHERE email_hash = ?').get(hashEmail(email));
    if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash)) {
      throw unauthorized('Wrong email or password.');
    }
    if (config.adminEmails.includes(email) && user.role !== 'admin') {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
    }
    createSession(db, res, user.id);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  r.post('/forgot', async (req, res) => {
    const email = readEmail(req.body);
    hit(`forgot:ip:${req.ip}`, 10, 3600_000);
    hit(`forgot:email:${hashEmail(email)}`, 3, 900_000);
    const user = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(hashEmail(email));
    let out = {};
    if (user) out = await issueCode(db, { purpose: 'reset', email, userId: user.id });
    res.json({ ok: true, ...out });
  });

  r.post('/reset', (req, res) => {
    const email = readEmail(req.body);
    const password = readPassword(req.body.password);
    hit(`reset:ip:${req.ip}`, 20, 3600_000);
    const { emailHash } = consumeCode(db, { purpose: 'reset', email, code: req.body.code });
    const user = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(emailHash);
    if (!user) throw badRequest('No account for that email.');
    tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
    createSession(db, res, user.id);
    res.json({ ok: true });
  });

  r.post('/change-password', requireUser, (req, res) => {
    if (!verifyPassword(String(req.body.current ?? ''), req.user.password_hash)) throw badRequest('Your current password is wrong.');
    const next = readPassword(req.body.next);
    tx(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    });
    createSession(db, res, req.user.id);
    res.json({ ok: true });
  });

  r.post('/logout-everywhere', requireUser, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  return r;
}
