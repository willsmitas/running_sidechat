import { Router } from 'express';
import { prepareLoose } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { boardAccess, lockedMessage, visibleBoardIds } from '../lib/access.js';
import { getSettings } from '../lib/settings.js';
import { POST_SELECT, serializePosts } from '../lib/serialize.js';
import { requireUser } from '../lib/session.js';

const PAGE = 25;
const TOP_WINDOWS = { day: 86400_000, week: 7 * 86400_000, month: 30 * 86400_000, year: 365 * 86400_000, all: null };

export function getBoardOr404(db, slug) {
  const board = db.prepare('SELECT * FROM boards WHERE slug = ?').get(String(slug));
  if (!board) throw notFound('That board does not exist.');
  return board;
}

function boardJson(db, user, b, prefs) {
  const a = boardAccess(db, user, b);
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    emoji: b.emoji,
    kind: b.kind,
    division: b.division,
    conferenceId: b.conference_id,
    archived: !!b.archived,
    canView: a.canView,
    canPost: a.canPost,
    member: a.member,
    locked: !a.canView,
    lockedReason: a.reason,
    lockedMessage: a.canView ? null : lockedMessage(a.reason, b),
    starred: !!prefs?.starred,
    muted: !!prefs?.muted,
  };
}

export default function boardRoutes(db) {
  const r = Router();

  r.get('/boards', (req, res) => {
    const boards = db.prepare('SELECT * FROM boards ORDER BY position, name').all();
    const prefs = req.user
      ? new Map(db.prepare('SELECT * FROM board_prefs WHERE user_id = ?').all(req.user.id).map((p) => [p.board_id, p]))
      : new Map();
    const counts = new Map(db.prepare(`SELECT board_id, COUNT(*) AS n FROM posts
      WHERE deleted_at IS NULL AND removed_at IS NULL AND created_at > ? GROUP BY board_id`).all(Date.now() - 86400_000).map((r) => [r.board_id, r.n]));
    res.json({
      boards: boards
        .filter((b) => !b.archived || req.user?.role === 'admin')
        .map((b) => ({ ...boardJson(db, req.user, b, prefs.get(b.id)), postsToday: counts.get(b.id) || 0 })),
    });
  });

  r.get('/boards/:slug', (req, res) => {
    const board = getBoardOr404(db, req.params.slug);
    const prefs = req.user ? db.prepare('SELECT * FROM board_prefs WHERE user_id = ? AND board_id = ?').get(req.user.id, board.id) : null;
    const json = boardJson(db, req.user, board, prefs);
    if (board.kind === 'conference') {
      json.schools = db.prepare('SELECT name FROM schools WHERE conference_id = ? AND active = 1 ORDER BY name').all(board.conference_id).map((s) => s.name);
    }
    res.json({ board: json });
  });

  r.post('/boards/:slug/prefs', requireUser, (req, res) => {
    const board = getBoardOr404(db, req.params.slug);
    const cur = db.prepare('SELECT * FROM board_prefs WHERE user_id = ? AND board_id = ?').get(req.user.id, board.id) || { starred: 0, muted: 0 };
    const starred = req.body.starred === undefined ? cur.starred : req.body.starred ? 1 : 0;
    const muted = req.body.muted === undefined ? cur.muted : req.body.muted ? 1 : 0;
    db.prepare(`INSERT INTO board_prefs (user_id, board_id, starred, muted) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, board_id) DO UPDATE SET starred = excluded.starred, muted = excluded.muted`).run(req.user.id, board.id, starred, muted);
    res.json({ ok: true, starred: !!starred, muted: !!muted });
  });

  r.get('/feed', (req, res) => {
    const sort = ['hot', 'new', 'top', 'active'].includes(req.query.sort) ? req.query.sort : 'hot';
    const t = req.query.t in TOP_WINDOWS ? req.query.t : 'week';
    const offset = Math.max(0, Math.min(5000, Number(req.query.offset) || 0));
    const slug = req.query.board && req.query.board !== 'home' ? String(req.query.board) : null;
    const now = Date.now();
    const uid = req.user?.id ?? 0;

    let boardIds;
    let board = null;
    if (slug === 'starred') {
      if (!req.user) return res.json({ posts: [], nextOffset: null });
      const visible = new Set(visibleBoardIds(db, req.user));
      boardIds = db.prepare('SELECT board_id FROM board_prefs WHERE user_id = ? AND starred = 1').all(uid).map((r) => r.board_id).filter((id) => visible.has(id));
    } else if (slug === 'college') {
      // Every private board the viewer belongs to.
      boardIds = db.prepare("SELECT * FROM boards WHERE kind != 'public'").all()
        .filter((b) => boardAccess(db, req.user, b).member).map((b) => b.id);
    } else if (slug) {
      board = getBoardOr404(db, slug);
      const a = boardAccess(db, req.user, board);
      if (!a.canView) throw forbidden(lockedMessage(a.reason, board), { locked: true, reason: a.reason });
      boardIds = [board.id];
    } else {
      const muted = req.user ? new Set(db.prepare('SELECT board_id FROM board_prefs WHERE user_id = ? AND muted = 1').all(uid).map((r) => r.board_id)) : new Set();
      const archived = new Set(db.prepare('SELECT id FROM boards WHERE archived = 1').all().map((r) => r.id));
      boardIds = visibleBoardIds(db, req.user).filter((id) => !muted.has(id) && !archived.has(id));
    }
    if (!boardIds.length) return res.json({ posts: [], nextOffset: null });

    const where = [
      `p.board_id IN (${boardIds.map(Number).join(',')})`,
      'p.deleted_at IS NULL',
      'p.removed_at IS NULL',
      '(p.score > @minScore OR p.pinned = 1)',
    ];
    if (req.user) where.push('p.id NOT IN (SELECT post_id FROM hides WHERE user_id = @uid)');
    const params = { uid, minScore: getSettings(db).autoHideScore, now, limit: PAGE + 1, offset };
    if (sort === 'top' && TOP_WINDOWS[t]) {
      where.push('p.created_at > @since');
      params.since = now - TOP_WINDOWS[t];
    }
    const order = {
      hot: '((p.score + p.comment_count * 0.5 + 1) / pow((@now - p.created_at) / 3600000.0 + 2, 1.5)) DESC, p.id DESC',
      new: 'p.created_at DESC, p.id DESC',
      top: 'p.score DESC, p.id DESC',
      active: 'p.last_activity_at DESC, p.id DESC',
    }[sort];
    const pinFirst = board && offset === 0 ? 'p.pinned DESC, ' : '';
    const rows = prepareLoose(db, `${POST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${pinFirst}${order} LIMIT @limit OFFSET @offset`).all(params);
    const more = rows.length > PAGE;
    res.json({ posts: serializePosts(db, rows.slice(0, PAGE), req.user), nextOffset: more ? offset + PAGE : null });
  });

  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 200);
    const offset = Math.max(0, Math.min(1000, Number(req.query.offset) || 0));
    const terms = q.match(/[\p{L}\p{N}']+/gu) || [];
    if (!terms.length) throw badRequest('Search for something.');
    const match = terms.slice(0, 12).map((w, i, a) => `"${w.replace(/"/g, '')}"${i === a.length - 1 ? '*' : ''}`).join(' ');
    let boardIds = visibleBoardIds(db, req.user);
    if (req.query.board) {
      const board = getBoardOr404(db, req.query.board);
      boardIds = boardIds.filter((id) => id === board.id);
    }
    if (!boardIds.length) return res.json({ posts: [], nextOffset: null });
    const rows = prepareLoose(db, `${POST_SELECT}
      JOIN posts_fts ON posts_fts.rowid = p.id
      WHERE posts_fts MATCH @match AND p.board_id IN (${boardIds.join(',')})
        AND p.deleted_at IS NULL AND p.removed_at IS NULL
      ORDER BY bm25(posts_fts) + (-0.05 * p.score), p.created_at DESC LIMIT @limit OFFSET @offset`)
      .all({ uid: req.user?.id ?? 0, match, limit: PAGE + 1, offset });
    const more = rows.length > PAGE;
    res.json({ posts: serializePosts(db, rows.slice(0, PAGE), req.user), nextOffset: more ? offset + PAGE : null });
  });

  return r;
}
