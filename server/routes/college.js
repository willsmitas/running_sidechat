import { Router } from 'express';
import config from '../config.js';
import { hashEmail, isValidEmail, normalizeEmail } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { hit } from '../lib/ratelimit.js';
import { consumeCode, issueCode } from '../lib/codes.js';
import { requireActive } from '../lib/session.js';
import { emailDomain, getCollege, looksAcademic, schoolsForDomain } from '../lib/college.js';

export function grantCollege(db, { userId, schoolId, emailHash, silentIfTaken = false }) {
  const taken = db.prepare('SELECT user_id FROM college_verifications WHERE email_hash = ?').get(emailHash);
  if (taken && taken.user_id !== userId) {
    if (silentIfTaken) return null;
    throw badRequest('That school email is already linked to another account.');
  }
  const now = Date.now();
  db.prepare(`INSERT INTO college_verifications (user_id, school_id, email_hash, verified_at, expires_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET school_id = excluded.school_id, email_hash = excluded.email_hash,
      verified_at = excluded.verified_at, expires_at = excluded.expires_at`)
    .run(userId, schoolId, emailHash, now, now + config.collegeVerifyDays * 86400_000);
  db.prepare("UPDATE verification_requests SET status = 'approved', resolved_at = ? WHERE user_id = ? AND status = 'pending'").run(now, userId);
  return getCollege(db, userId);
}

export default function collegeRoutes(db) {
  const r = Router();

  r.get('/schools', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ schools: [] });
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const schools = db.prepare(`
      SELECT s.id, s.name, c.short_name AS conference, c.division
      FROM schools s JOIN conferences c ON c.id = s.conference_id
      WHERE s.active = 1 AND (s.name LIKE ? ESCAPE '\\' OR c.short_name LIKE ? ESCAPE '\\')
      ORDER BY (s.name LIKE ? ESCAPE '\\') DESC, s.name LIMIT 25`).all(like, like, `${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    res.json({ schools });
  });

  r.get('/conferences', (_req, res) => {
    const confs = db.prepare(`
      SELECT c.id, c.slug, c.name, c.short_name AS short, c.division,
             (SELECT COUNT(*) FROM schools s WHERE s.conference_id = c.id AND s.active = 1) AS school_count
      FROM conferences c ORDER BY c.division, c.name`).all();
    const schools = db.prepare('SELECT id, name, conference_id FROM schools WHERE active = 1 ORDER BY name').all();
    const byConf = new Map();
    for (const s of schools) {
      if (!byConf.has(s.conference_id)) byConf.set(s.conference_id, []);
      byConf.get(s.conference_id).push(s.name);
    }
    res.json({ conferences: confs.map((c) => ({ ...c, schools: byConf.get(c.id) || [] })) });
  });

  r.post('/college/start', requireActive, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!isValidEmail(email)) throw badRequest('Enter your school email address.');
    hit(`college:user:${req.user.id}`, 6, 3600_000);
    const domain = emailDomain(email);
    const emailHash = hashEmail(email);
    const taken = db.prepare('SELECT user_id FROM college_verifications WHERE email_hash = ?').get(emailHash);
    if (taken && taken.user_id !== req.user.id) throw badRequest('That school email is already linked to another account.');

    const { schools } = schoolsForDomain(db, domain);
    let schoolId = req.body.schoolId ? Number(req.body.schoolId) : null;
    let manual = false;

    if (schools.length === 1) {
      schoolId = schools[0].id;
    } else if (schools.length > 1) {
      if (!schoolId || !schools.some((s) => s.id === schoolId)) {
        return res.json({ ok: false, needsChoice: true, schools });
      }
    } else {
      if (!looksAcademic(domain)) {
        throw badRequest('Use the email your school gave you (it usually ends in .edu).');
      }
      if (!schoolId) return res.json({ ok: false, needsManual: true, domain });
      const school = db.prepare('SELECT id FROM schools WHERE id = ? AND active = 1').get(schoolId);
      if (!school) throw badRequest('Pick your school from the list.');
      manual = true;
    }

    const out = await issueCode(db, { purpose: 'college', email, userId: req.user.id, data: { schoolId, manual, domain } });
    res.json({ ok: true, sent: true, manual, ...out });
  });

  r.post('/college/confirm', requireActive, (req, res) => {
    const email = normalizeEmail(req.body.email);
    const { emailHash, data } = consumeCode(db, { purpose: 'college', email, code: req.body.code, userId: req.user.id });
    if (data.manual) {
      db.prepare("DELETE FROM verification_requests WHERE user_id = ? AND status = 'pending'").run(req.user.id);
      db.prepare('INSERT INTO verification_requests (user_id, email_hash, domain, school_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, emailHash, data.domain, data.schoolId, String(req.body.note || '').slice(0, 300) || null, Date.now());
      return res.json({ ok: true, pending: true });
    }
    const college = grantCollege(db, { userId: req.user.id, schoolId: data.schoolId, emailHash });
    res.json({ ok: true, college });
  });

  r.get('/college/request', requireActive, (req, res) => {
    const reqRow = db.prepare(`SELECT vr.status, vr.created_at, vr.domain, s.name AS school
      FROM verification_requests vr JOIN schools s ON s.id = vr.school_id
      WHERE vr.user_id = ? ORDER BY vr.id DESC LIMIT 1`).get(req.user.id);
    res.json({ request: reqRow || null });
  });

  r.delete('/college', requireActive, (req, res) => {
    db.prepare('DELETE FROM college_verifications WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  return r;
}
