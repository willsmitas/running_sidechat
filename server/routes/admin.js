import { Router } from 'express';
import config from '../config.js';
import { tx } from '../db.js';
import { hashEmail, normalizeEmail } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { getCollege } from '../lib/college.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { notify, snippet } from '../lib/notify.js';
import { deleteImage } from '../lib/images.js';
import { POST_SELECT, serializePosts } from '../lib/serialize.js';
import { requireAdmin, requireStaff } from '../lib/session.js';
import { REPORT_REASONS } from './reports.js';
import { gifUrl } from '../lib/giphy.js';

export function logAction(db, modId, action, targetKind = null, targetId = null, details = null) {
  db.prepare('INSERT INTO mod_actions (mod_id, action, target_kind, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(modId, action, targetKind, targetId, details ? String(details).slice(0, 500) : null, Date.now());
}

const TABLES = { post: 'posts', comment: 'comments', message: 'messages' };

function loadTarget(db, kind, id) {
  const table = TABLES[kind];
  if (!table) throw badRequest('Unknown content type.');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
  if (!row) throw notFound();
  return { table, row };
}

function removeContent(db, mod, kind, id, reason) {
  const { table, row } = loadTarget(db, kind, id);
  const why = String(reason || 'Removed by moderators').slice(0, 200);
  if (kind === 'message') db.prepare('UPDATE messages SET removed_at = ? WHERE id = ?').run(Date.now(), row.id);
  else db.prepare(`UPDATE ${table} SET removed_at = ?, removed_by = ?, removal_reason = ? WHERE id = ?`).run(Date.now(), mod.id, why, row.id);
  db.prepare("UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? WHERE kind = ? AND target_id = ? AND status = 'open'")
    .run(Date.now(), mod.id, kind, row.id);
  logAction(db, mod.id, 'remove', kind, row.id, why);
  const owner = kind === 'message' ? row.sender_id : row.user_id;
  if (owner && kind !== 'message') {
    notify(db, {
      userId: owner, type: 'removed', postId: kind === 'post' ? row.id : row.post_id, commentId: kind === 'comment' ? row.id : null,
      text: `Your ${kind} “${snippet(row.body, 40)}” was removed: ${why}`,
    });
  }
}

function restoreContent(db, mod, kind, id) {
  const { table, row } = loadTarget(db, kind, id);
  if (kind === 'message') db.prepare('UPDATE messages SET removed_at = NULL WHERE id = ?').run(row.id);
  else db.prepare(`UPDATE ${table} SET removed_at = NULL, removed_by = NULL, removal_reason = NULL, report_count = 0 WHERE id = ?`).run(row.id);
  db.prepare("UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE kind = ? AND target_id = ? AND status = 'open'")
    .run(Date.now(), mod.id, kind, row.id);
  logAction(db, mod.id, 'restore', kind, row.id);
}

function userJson(db, u) {
  const stats = db.prepare(`SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = @u) AS posts,
      (SELECT COUNT(*) FROM comments WHERE user_id = @u) AS comments,
      (SELECT COUNT(*) FROM posts WHERE user_id = @u AND removed_at IS NOT NULL) +
      (SELECT COUNT(*) FROM comments WHERE user_id = @u AND removed_at IS NOT NULL) AS removed,
      (SELECT COUNT(*) FROM reports r JOIN posts p ON r.kind = 'post' AND p.id = r.target_id WHERE p.user_id = @u) +
      (SELECT COUNT(*) FROM reports r JOIN comments c ON r.kind = 'comment' AND c.id = r.target_id WHERE c.user_id = @u) AS reportsAgainst`).get({ u: u.id });
  const college = getCollege(db, u.id);
  return {
    id: u.id,
    role: u.role,
    createdAt: u.created_at,
    lastActiveAt: u.last_active_at,
    bannedUntil: u.banned_until && u.banned_until > Date.now() ? u.banned_until : null,
    banReason: u.ban_reason,
    // Staff see division/conference (needed to judge board access) but not
    // the school, which would make small-program runners identifiable.
    college: college ? { division: college.division, conference: college.conferenceShort, active: college.active } : null,
    ...stats,
  };
}

export default function adminRoutes(db) {
  const r = Router();
  r.use(requireStaff);

  r.get('/stats', (_req, res) => {
    const day = Date.now() - 86400_000;
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    res.json({
      users: one('SELECT COUNT(*) AS n FROM users'),
      verified: one('SELECT COUNT(*) AS n FROM college_verifications WHERE expires_at > ?', Date.now()),
      activeToday: one('SELECT COUNT(*) AS n FROM users WHERE last_active_at > ?', day),
      postsToday: one('SELECT COUNT(*) AS n FROM posts WHERE created_at > ?', day),
      commentsToday: one('SELECT COUNT(*) AS n FROM comments WHERE created_at > ?', day),
      openReports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      pendingVerifications: one("SELECT COUNT(*) AS n FROM verification_requests WHERE status = 'pending'"),
      byDivision: db.prepare(`SELECT c.division, COUNT(*) AS n FROM college_verifications cv JOIN schools s ON s.id = cv.school_id
        JOIN conferences c ON c.id = s.conference_id WHERE cv.expires_at > ? GROUP BY c.division`).all(Date.now()),
    });
  });

  // ---- Reports -------------------------------------------------------------
  r.get('/reports', (req, res) => {
    const status = ['open', 'dismissed', 'actioned'].includes(req.query.status) ? req.query.status : 'open';
    const rows = db.prepare(`SELECT kind, target_id, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at,
        GROUP_CONCAT(reason) AS reasons, GROUP_CONCAT(COALESCE(details, ''), ' | ') AS details
      FROM reports WHERE status = ? GROUP BY kind, target_id ORDER BY n DESC, last_at DESC LIMIT 100`).all(status);
    const items = rows.map((r) => {
      const { row } = (() => { try { return loadTarget(db, r.kind, r.target_id); } catch { return { row: null }; } })();
      let target = null;
      if (row) {
        if (r.kind === 'post') {
          const p = db.prepare(`${POST_SELECT} WHERE p.id = @id`).get({ uid: 0, id: row.id });
          target = serializePosts(db, [p], { id: 0, role: 'admin' })[0];
        } else if (r.kind === 'comment') {
          target = { id: row.id, postId: row.post_id, body: row.body, image: row.image ? `/uploads/${row.image}` : null, gif: row.gif ? gifUrl(row.gif) : null, score: row.score, removed: !!row.removed_at, authorId: row.user_id, deleted: !!row.deleted_at };
        } else {
          const conv = db.prepare('SELECT post_id FROM conversations WHERE id = ?').get(row.conversation_id);
          target = { id: row.id, postId: conv?.post_id ?? null, body: row.body, removed: !!row.removed_at, authorId: row.sender_id };
        }
      }
      const reasons = {};
      for (const x of String(r.reasons || '').split(',')) if (x) reasons[x] = (reasons[x] || 0) + 1;
      return {
        kind: r.kind, targetId: r.target_id, count: r.n, firstAt: r.first_at, lastAt: r.last_at,
        reasons: Object.entries(reasons).map(([k, n]) => ({ key: k, label: REPORT_REASONS[k] || k, n })),
        details: String(r.details || '').split(' | ').filter(Boolean),
        target,
      };
    });
    res.json({ reports: items });
  });

  r.post('/reports/resolve', (req, res) => {
    const { kind, id, action, reason } = req.body;
    tx(db, () => {
      if (action === 'remove') removeContent(db, req.user, kind, id, reason);
      else if (action === 'dismiss') restoreContent(db, req.user, kind, id);
      else throw badRequest('Action must be remove or dismiss.');
    });
    res.json({ ok: true });
  });

  r.post('/remove', (req, res) => {
    tx(db, () => removeContent(db, req.user, req.body.kind, req.body.id, req.body.reason));
    res.json({ ok: true });
  });

  r.post('/restore', (req, res) => {
    tx(db, () => restoreContent(db, req.user, req.body.kind, req.body.id));
    res.json({ ok: true });
  });

  r.get('/removed', (_req, res) => {
    const rows = db.prepare(`${POST_SELECT} WHERE p.removed_at IS NOT NULL AND p.deleted_at IS NULL ORDER BY p.removed_at DESC LIMIT 100`).all({ uid: 0 });
    res.json({ posts: serializePosts(db, rows, { id: 0, role: 'admin' }) });
  });

  // ---- Users ---------------------------------------------------------------
  r.get('/users', (req, res) => {
    let rows;
    if (req.query.email) rows = db.prepare('SELECT * FROM users WHERE email_hash = ?').all(hashEmail(normalizeEmail(req.query.email)));
    else if (req.query.id) rows = db.prepare('SELECT * FROM users WHERE id = ?').all(Number(req.query.id));
    else if (req.query.filter === 'banned') rows = db.prepare('SELECT * FROM users WHERE banned_until > ? ORDER BY banned_until DESC LIMIT 100').all(Date.now());
    else if (req.query.filter === 'staff') rows = db.prepare("SELECT * FROM users WHERE role != 'user' ORDER BY id").all();
    else rows = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 50').all();
    res.json({ users: rows.map((u) => userJson(db, u)) });
  });

  r.get('/users/:id/content', (req, res) => {
    const uid = Number(req.params.id);
    const posts = db.prepare(`${POST_SELECT} WHERE p.user_id = @author ORDER BY p.created_at DESC LIMIT 50`).all({ uid: 0, author: uid });
    const comments = db.prepare('SELECT id, post_id, body, score, created_at, removed_at, deleted_at FROM comments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(uid);
    res.json({
      posts: serializePosts(db, posts, { id: 0, role: 'admin' }),
      comments: comments.map((c) => ({ id: c.id, postId: c.post_id, body: c.body, score: c.score, createdAt: c.created_at, removed: !!c.removed_at, deleted: !!c.deleted_at })),
    });
  });

  r.post('/users/:id/ban', (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!target) throw notFound();
    if (target.role === 'admin' || (target.role === 'mod' && req.user.role !== 'admin')) throw forbidden('You can’t ban staff.');
    const days = Number(req.body.days);
    if (!(days > 0 && days <= 36500)) throw badRequest('Ban length must be 1 to 36500 days.');
    const reason = String(req.body.reason || '').slice(0, 200) || null;
    const until = Date.now() + days * 86400_000;
    tx(db, () => {
      db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?').run(until, reason, target.id);
      if (req.body.purge) {
        db.prepare("UPDATE posts SET removed_at = ?, removed_by = ?, removal_reason = 'Author banned' WHERE user_id = ? AND removed_at IS NULL").run(Date.now(), req.user.id, target.id);
        db.prepare("UPDATE comments SET removed_at = ?, removed_by = ?, removal_reason = 'Author banned' WHERE user_id = ? AND removed_at IS NULL").run(Date.now(), req.user.id, target.id);
      }
      logAction(db, req.user.id, 'ban', 'user', target.id, `${days}d${reason ? `: ${reason}` : ''}${req.body.purge ? ' (purged)' : ''}`);
    });
    res.json({ ok: true, until });
  });

  r.post('/users/:id/unban', (req, res) => {
    db.prepare('UPDATE users SET banned_until = NULL, ban_reason = NULL WHERE id = ?').run(Number(req.params.id));
    logAction(db, req.user.id, 'unban', 'user', Number(req.params.id));
    res.json({ ok: true });
  });

  r.post('/users/:id/role', requireAdmin, (req, res) => {
    const role = String(req.body.role);
    if (!['user', 'mod', 'admin'].includes(role)) throw badRequest('Unknown role.');
    const id = Number(req.params.id);
    if (id === req.user.id) throw badRequest('You can’t change your own role.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    logAction(db, req.user.id, 'role', 'user', id, role);
    res.json({ ok: true });
  });

  r.post('/users/:id/revoke-college', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM college_verifications WHERE user_id = ?').run(id);
    logAction(db, req.user.id, 'revoke_college', 'user', id, req.body.reason);
    res.json({ ok: true });
  });

  // ---- College verification requests --------------------------------------
  r.get('/verifications', (req, res) => {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = db.prepare(`SELECT vr.*, s.name AS school, c.short_name AS conference, c.division,
        (SELECT GROUP_CONCAT(domain, ', ') FROM school_domains WHERE school_id = s.id) AS known_domains
      FROM verification_requests vr JOIN schools s ON s.id = vr.school_id JOIN conferences c ON c.id = s.conference_id
      WHERE vr.status = ? ORDER BY vr.created_at LIMIT 200`).all(status);
    res.json({
      requests: rows.map((v) => ({
        id: v.id, userId: v.user_id, domain: v.domain, schoolId: v.school_id, school: v.school, conference: v.conference,
        division: v.division, knownDomains: v.known_domains, note: v.note, status: v.status, createdAt: v.created_at,
      })),
    });
  });

  r.post('/verifications/:id', (req, res) => {
    const v = db.prepare('SELECT * FROM verification_requests WHERE id = ?').get(Number(req.params.id));
    if (!v) throw notFound();
    if (v.status !== 'pending') throw badRequest('Already handled.');
    const approve = req.body.action === 'approve';
    tx(db, () => {
      if (approve) {
        const taken = db.prepare('SELECT user_id FROM college_verifications WHERE email_hash = ?').get(v.email_hash);
        if (taken && taken.user_id !== v.user_id) throw badRequest('That school email is already linked to another account.');
        const now = Date.now();
        db.prepare(`INSERT INTO college_verifications (user_id, school_id, email_hash, verified_at, expires_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET school_id = excluded.school_id, email_hash = excluded.email_hash,
            verified_at = excluded.verified_at, expires_at = excluded.expires_at`)
          .run(v.user_id, v.school_id, v.email_hash, now, now + config.collegeVerifyDays * 86400_000);
        // Optionally teach the system this domain so the next student from
        // the school is verified automatically.
        if (req.body.addDomain) db.prepare('INSERT OR IGNORE INTO school_domains (domain, school_id) VALUES (?, ?)').run(v.domain, v.school_id);
        notify(db, { userId: v.user_id, type: 'college', text: 'Your college email was approved. Your conference and division boards are unlocked.' });
      } else {
        notify(db, { userId: v.user_id, type: 'college', text: `We couldn’t verify your school email${req.body.reason ? `: ${String(req.body.reason).slice(0, 200)}` : '.'}` });
      }
      db.prepare('UPDATE verification_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
        .run(approve ? 'approved' : 'rejected', Date.now(), req.user.id, v.id);
      logAction(db, req.user.id, approve ? 'approve_college' : 'reject_college', 'user', v.user_id, `${v.domain}${req.body.addDomain ? ' (+domain)' : ''}`);
    });
    res.json({ ok: true });
  });

  // ---- Boards (admin) ------------------------------------------------------
  const readBoard = (body, existing = {}) => {
    const name = String(body.name ?? existing.name ?? '').trim();
    if (!name || name.length > 60) throw badRequest('Board names must be 1 to 60 characters.');
    const description = String(body.description ?? existing.description ?? '').trim().slice(0, 300);
    const emoji = String(body.emoji ?? existing.emoji ?? '💬').trim().slice(0, 8) || '💬';
    const position = Number(body.position ?? existing.position ?? 0) || 0;
    return { name, description, emoji, position };
  };

  r.get('/boards', requireAdmin, (_req, res) => {
    const rows = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM posts WHERE board_id = b.id) AS post_count FROM boards b ORDER BY b.kind != 'public', b.position, b.name`).all();
    res.json({ boards: rows });
  });

  r.post('/boards', requireAdmin, (req, res) => {
    const slug = String(req.body.slug || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) throw badRequest('Slugs are 2–40 lowercase letters, numbers, or dashes.');
    if (['home', 'starred', 'college', 'new', 'search'].includes(slug) || slug.startsWith('conf-') || /^d[123]$/.test(slug) || slug === 'ncaa') {
      throw badRequest('That slug is reserved.');
    }
    if (db.prepare('SELECT 1 FROM boards WHERE slug = ?').get(slug)) throw badRequest('That slug is taken.');
    const b = readBoard(req.body);
    const id = Number(db.prepare(`INSERT INTO boards (slug, name, description, emoji, kind, position, created_at) VALUES (?, ?, ?, ?, 'public', ?, ?)`)
      .run(slug, b.name, b.description, b.emoji, b.position, Date.now()).lastInsertRowid);
    logAction(db, req.user.id, 'create_board', 'board', id, slug);
    res.status(201).json({ board: db.prepare('SELECT * FROM boards WHERE id = ?').get(id) });
  });

  r.patch('/boards/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM boards WHERE id = ?').get(Number(req.params.id));
    if (!existing) throw notFound();
    const b = readBoard(req.body, existing);
    const archived = req.body.archived === undefined ? existing.archived : req.body.archived ? 1 : 0;
    db.prepare('UPDATE boards SET name = ?, description = ?, emoji = ?, position = ?, archived = ? WHERE id = ?')
      .run(b.name, b.description, b.emoji, b.position, archived, existing.id);
    logAction(db, req.user.id, 'edit_board', 'board', existing.id, existing.slug);
    res.json({ board: db.prepare('SELECT * FROM boards WHERE id = ?').get(existing.id) });
  });

  r.delete('/boards/:id', requireAdmin, (req, res) => {
    const existing = db.prepare('SELECT * FROM boards WHERE id = ?').get(Number(req.params.id));
    if (!existing) throw notFound();
    if (existing.kind !== 'public') throw badRequest('College boards can’t be deleted. Archive them instead.');
    const posts = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE board_id = ?').get(existing.id).n;
    if (posts && !req.body?.force) throw badRequest(`This board has ${posts} posts. Archive it instead, or delete with force.`);
    const images = db.prepare('SELECT image FROM posts WHERE board_id = ? AND image IS NOT NULL').all(existing.id);
    db.prepare('DELETE FROM boards WHERE id = ?').run(existing.id);
    images.forEach((i) => deleteImage(config.uploadDir, i.image));
    logAction(db, req.user.id, 'delete_board', 'board', existing.id, existing.slug);
    res.json({ ok: true });
  });

  // ---- Conferences & schools (admin) --------------------------------------
  r.get('/conferences', requireAdmin, (_req, res) => {
    res.json({
      conferences: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM schools WHERE conference_id = c.id) AS school_count
        FROM conferences c ORDER BY division, name`).all(),
    });
  });

  r.post('/conferences', requireAdmin, (req, res) => {
    const slug = String(req.body.slug || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const short = String(req.body.short || name).trim();
    const division = Number(req.body.division);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) throw badRequest('Invalid slug.');
    if (!name || name.length > 80 || !short || short.length > 30) throw badRequest('Name required (short name 30 chars max).');
    if (![1, 2, 3].includes(division)) throw badRequest('Division must be 1, 2, or 3.');
    if (db.prepare('SELECT 1 FROM conferences WHERE slug = ?').get(slug)) throw badRequest('That conference already exists.');
    const id = tx(db, () => {
      const cid = Number(db.prepare('INSERT INTO conferences (slug, name, short_name, division) VALUES (?, ?, ?, ?)').run(slug, name, short, division).lastInsertRowid);
      db.prepare(`INSERT INTO boards (slug, name, description, emoji, kind, division, conference_id, position, created_at)
        VALUES (?, ?, ?, '🏟️', 'conference', ?, ?, ?, ?)`).run(`conf-${slug}`, short, name, division, cid, 100 * division + 99, Date.now());
      return cid;
    });
    logAction(db, req.user.id, 'create_conference', 'conference', id, slug);
    res.status(201).json({ conference: db.prepare('SELECT * FROM conferences WHERE id = ?').get(id) });
  });

  r.patch('/conferences/:id', requireAdmin, (req, res) => {
    const c = db.prepare('SELECT * FROM conferences WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound();
    const name = String(req.body.name ?? c.name).trim();
    const short = String(req.body.short ?? c.short_name).trim();
    const division = Number(req.body.division ?? c.division);
    if (![1, 2, 3].includes(division)) throw badRequest('Division must be 1, 2, or 3.');
    tx(db, () => {
      db.prepare('UPDATE conferences SET name = ?, short_name = ?, division = ? WHERE id = ?').run(name, short, division, c.id);
      db.prepare("UPDATE boards SET name = ?, description = ?, division = ? WHERE kind = 'conference' AND conference_id = ?").run(short, name, division, c.id);
    });
    logAction(db, req.user.id, 'edit_conference', 'conference', c.id, c.slug);
    res.json({ ok: true });
  });

  r.get('/schools', requireAdmin, (req, res) => {
    const q = String(req.query.q || '').trim();
    const conf = req.query.conference ? Number(req.query.conference) : null;
    const rows = db.prepare(`SELECT s.*, c.short_name AS conference, c.division,
        (SELECT GROUP_CONCAT(domain, ' ') FROM school_domains WHERE school_id = s.id) AS domains,
        (SELECT COUNT(*) FROM college_verifications WHERE school_id = s.id) AS verified
      FROM schools s JOIN conferences c ON c.id = s.conference_id
      WHERE (@q = '' OR s.name LIKE @like) AND (@conf IS NULL OR s.conference_id = @conf)
      ORDER BY s.name LIMIT 200`).all({ q, like: `%${q}%`, conf });
    res.json({ schools: rows.map((s) => ({ ...s, domains: s.domains ? s.domains.split(' ') : [] })) });
  });

  const readDomains = (raw) => {
    const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/)).map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    for (const d of list) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw badRequest(`“${d}” isn’t a valid domain.`);
    return [...new Set(list)];
  };

  r.post('/schools', requireAdmin, (req, res) => {
    const name = String(req.body.name || '').trim();
    const conferenceId = Number(req.body.conferenceId);
    if (!name || name.length > 80) throw badRequest('School name required.');
    if (!db.prepare('SELECT 1 FROM conferences WHERE id = ?').get(conferenceId)) throw badRequest('Pick a conference.');
    const domains = readDomains(req.body.domains);
    const id = tx(db, () => {
      const sid = Number(db.prepare('INSERT INTO schools (name, conference_id) VALUES (?, ?)').run(name, conferenceId).lastInsertRowid);
      for (const d of domains) db.prepare('INSERT OR IGNORE INTO school_domains (domain, school_id) VALUES (?, ?)').run(d, sid);
      return sid;
    });
    logAction(db, req.user.id, 'create_school', 'school', id, name);
    res.status(201).json({ id });
  });

  // Moving a school to another conference immediately moves its verified
  // students' board access too, since access is derived from the school.
  r.patch('/schools/:id', requireAdmin, (req, res) => {
    const s = db.prepare('SELECT * FROM schools WHERE id = ?').get(Number(req.params.id));
    if (!s) throw notFound();
    const name = String(req.body.name ?? s.name).trim();
    const conferenceId = Number(req.body.conferenceId ?? s.conference_id);
    const active = req.body.active === undefined ? s.active : req.body.active ? 1 : 0;
    if (!db.prepare('SELECT 1 FROM conferences WHERE id = ?').get(conferenceId)) throw badRequest('Pick a conference.');
    tx(db, () => {
      db.prepare('UPDATE schools SET name = ?, conference_id = ?, active = ? WHERE id = ?').run(name, conferenceId, active, s.id);
      if (req.body.domains !== undefined) {
        db.prepare('DELETE FROM school_domains WHERE school_id = ?').run(s.id);
        for (const d of readDomains(req.body.domains)) db.prepare('INSERT OR IGNORE INTO school_domains (domain, school_id) VALUES (?, ?)').run(d, s.id);
      }
    });
    logAction(db, req.user.id, 'edit_school', 'school', s.id, name);
    res.json({ ok: true });
  });

  // ---- Settings & log ------------------------------------------------------
  r.get('/settings', requireAdmin, (_req, res) => res.json({ settings: getSettings(db) }));
  r.put('/settings', requireAdmin, (req, res) => {
    const settings = updateSettings(db, req.body || {});
    logAction(db, req.user.id, 'settings', null, null, Object.keys(req.body || {}).join(', '));
    res.json({ settings });
  });

  r.get('/log', (_req, res) => {
    const rows = db.prepare('SELECT * FROM mod_actions ORDER BY id DESC LIMIT 200').all();
    res.json({ log: rows.map((a) => ({ id: a.id, modId: a.mod_id, action: a.action, targetKind: a.target_kind, targetId: a.target_id, details: a.details, createdAt: a.created_at })) });
  });

  return r;
}
