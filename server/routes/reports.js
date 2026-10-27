import { Router } from 'express';
import { badRequest, notFound } from '../lib/errors.js';
import { hit } from '../lib/ratelimit.js';
import { getSettings } from '../lib/settings.js';
import { requireActive } from '../lib/session.js';

export const REPORT_REASONS = {
  harassment: 'Harassment or bullying',
  doxxing: 'Reveals someone’s identity or private info',
  hate: 'Hate speech',
  threat: 'Threats or violence',
  self_harm: 'Self-harm or suicide concern',
  sexual: 'Sexual content',
  spam: 'Spam or advertising',
  misinfo: 'Defamation or false claims about a real person',
  other: 'Something else',
};

export default function reportRoutes(db) {
  const r = Router();

  r.get('/reports/reasons', (_req, res) => res.json({ reasons: REPORT_REASONS }));

  r.post('/reports', requireActive, (req, res) => {
    const kind = String(req.body.kind);
    const id = Number(req.body.id);
    const reason = String(req.body.reason);
    if (!['post', 'comment', 'message'].includes(kind)) throw badRequest('Unknown content type.');
    if (!(reason in REPORT_REASONS)) throw badRequest('Pick a reason.');
    const details = String(req.body.details || '').trim().slice(0, 500) || null;
    hit(`report:${req.user.id}`, 30, 3600_000);

    let target;
    if (kind === 'message') {
      target = db.prepare(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.id = ? AND (c.starter_id = ? OR c.recipient_id = ?)`).get(id, req.user.id, req.user.id);
    } else {
      target = db.prepare(`SELECT * FROM ${kind === 'post' ? 'posts' : 'comments'} WHERE id = ?`).get(id);
    }
    if (!target) throw notFound();

    const inserted = db.prepare('INSERT OR IGNORE INTO reports (reporter_id, kind, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, kind, id, reason, details, Date.now()).changes;
    if (inserted && kind !== 'message') {
      const table = kind === 'post' ? 'posts' : 'comments';
      db.prepare(`UPDATE ${table} SET report_count = report_count + 1 WHERE id = ?`).run(id);
      const { report_count: n, removed_at: removed } = db.prepare(`SELECT report_count, removed_at FROM ${table} WHERE id = ?`).get(id);
      // Enough independent reports hide content until a moderator looks.
      if (!removed && n >= getSettings(db).reportThreshold) {
        db.prepare(`UPDATE ${table} SET removed_at = ?, removal_reason = 'Hidden pending moderator review' WHERE id = ?`).run(Date.now(), id);
      }
    }
    res.json({ ok: true });
  });

  return r;
}
