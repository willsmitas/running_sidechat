import { Router } from 'express';
import multer from 'multer';
import config from '../config.js';
import { tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { boardAccess, isBanned, isStaff, lockedMessage } from '../lib/access.js';
import { cleanText, checkContent } from '../lib/content.js';
import { hit } from '../lib/ratelimit.js';
import { deleteImage, MAX_IMAGE_BYTES, saveImage } from '../lib/images.js';
import { POST_SELECT, serializeComment, serializePosts } from '../lib/serialize.js';
import { requireActive } from '../lib/session.js';
import { aliasFor } from '../lib/aliases.js';
import { getSettings } from '../lib/settings.js';
import { ensureAlias } from '../lib/threads.js';
import { onNewComment, onScoreChange } from '../lib/notify.js';
import { getBoardOr404 } from './boards.js';
import { logAction } from './admin.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 20 },
});

function maybeUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  upload.single('image')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(badRequest('Images must be under 6 MB.'));
    next(err);
  });
}

function parsePoll(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let opts = raw;
  if (typeof raw === 'string') {
    try {
      opts = JSON.parse(raw);
    } catch {
      throw badRequest('Invalid poll.');
    }
  }
  if (!Array.isArray(opts)) throw badRequest('Invalid poll.');
  const clean = opts.map((o) => String(o ?? '').trim()).filter(Boolean);
  if (!clean.length) return null;
  if (clean.length < 2 || clean.length > 6) throw badRequest('Polls need 2 to 6 options.');
  if (clean.some((o) => o.length > 80)) throw badRequest('Poll options must be 80 characters or fewer.');
  if (new Set(clean.map((o) => o.toLowerCase())).size !== clean.length) throw badRequest('Poll options must be different.');
  return clean;
}

// Optional flair lets a verified runner show their division or conference
// without revealing their school. Flair that would be redundant on the board
// it's posted to (e.g. conference flair on that conference's board) is refused.
export function flairFor(user, board, choice) {
  if (!choice || choice === 'none') return null;
  const c = user.college;
  if (!c?.active) throw badRequest('Verify your college email to add flair.');
  if (choice === 'division') {
    if (board.kind === 'division' || board.kind === 'conference') throw badRequest('Everyone here is already in your division.');
    return `D${'I'.repeat(c.division)}`;
  }
  if (choice === 'conference') {
    if (board.kind === 'conference') throw badRequest('Everyone here is already in your conference.');
    return `D${'I'.repeat(c.division)} · ${c.conferenceShort}`;
  }
  throw badRequest('Unknown flair.');
}

function loadPost(db, id, user) {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = @id`).get({ uid: user?.id ?? 0, id: Number(id) || 0 });
  if (!row) throw notFound('That post does not exist.');
  return row;
}

function assertCanSee(db, user, row) {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(row.board_id);
  const a = boardAccess(db, user, board);
  if (!a.canView) throw forbidden(lockedMessage(a.reason, board), { locked: true, reason: a.reason, board: board.slug });
  if (row.deleted_at && !isStaff(user)) throw notFound('This post was deleted.');
  if (row.removed_at && !isStaff(user) && row.user_id !== user?.id) throw notFound('This post was removed by moderators.');
  return { board, access: a };
}

function assertCanParticipate(user, access) {
  if (isBanned(user)) throw forbidden('Your account is suspended.');
  if (!access.member) throw forbidden('Only members of this board can do that.');
}

function applyVote(db, kind, target, userId, value) {
  const table = kind === 'post' ? 'posts' : 'comments';
  return tx(db, () => {
    const prev = db.prepare('SELECT value FROM votes WHERE user_id = ? AND kind = ? AND target_id = ?').get(userId, kind, target.id)?.value ?? 0;
    if (prev === value) return { score: target.score, myVote: value };
    if (value === 0) db.prepare('DELETE FROM votes WHERE user_id = ? AND kind = ? AND target_id = ?').run(userId, kind, target.id);
    else {
      db.prepare(`INSERT INTO votes (user_id, kind, target_id, value, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, kind, target_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`)
        .run(userId, kind, target.id, value, Date.now());
    }
    const up = (value === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
    const down = (value === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
    db.prepare(`UPDATE ${table} SET upvotes = upvotes + ?, downvotes = downvotes + ?, score = score + ? WHERE id = ?`).run(up, down, up - down, target.id);
    const after = db.prepare(`SELECT score, upvotes FROM ${table} WHERE id = ?`).get(target.id);
    onScoreChange(db, { kind, target, before: target.upvotes, after: after.upvotes });
    return { score: after.score, myVote: value };
  });
}

function readVote(body) {
  const v = Number(body?.value);
  if (![1, 0, -1].includes(v)) throw badRequest('Vote must be 1, 0, or -1.');
  return v;
}

function commentsFor(db, postId, user, sort) {
  const rows = db.prepare(`SELECT c.*, v.value AS my_vote FROM comments c
    LEFT JOIN votes v ON v.user_id = ? AND v.kind = 'comment' AND v.target_id = c.id
    WHERE c.post_id = ? ORDER BY c.created_at, c.id`).all(user?.id ?? 0, postId);
  const staff = isStaff(user);
  const all = rows.map((c) => serializeComment(c, user, staff));
  // Drop deleted/removed leaves so empty placeholders only remain where
  // they're needed to keep a reply chain readable.
  const hasChild = new Set(all.filter((c) => c.parentId).map((c) => c.parentId));
  let visible = all.filter((c) => (c.body || c.author) || hasChild.has(c.id));
  for (let changed = true; changed;) {
    const live = new Set(visible.filter((c) => c.parentId).map((c) => c.parentId));
    const next = visible.filter((c) => (c.body || c.author) || live.has(c.id));
    changed = next.length !== visible.length;
    visible = next;
  }
  if (sort === 'top') visible.sort((a, b) => b.score - a.score || a.createdAt - b.createdAt);
  else if (sort === 'new') visible.sort((a, b) => b.createdAt - a.createdAt);
  return visible;
}

export default function postRoutes(db) {
  const r = Router();
  const uploadDir = config.uploadDir;

  r.post('/posts', requireActive, maybeUpload, (req, res) => {
    const board = getBoardOr404(db, req.body.board);
    const a = boardAccess(db, req.user, board);
    if (!a.canPost) throw forbidden(a.canView ? 'You can’t post on this board.' : lockedMessage(a.reason, board));
    const body = cleanText(req.body.body, { field: 'Your post', max: 2000 });
    checkContent(db, body);
    const poll = parsePoll(req.body.poll);
    const flair = flairFor(req.user, board, req.body.flair);
    hit(`post:${req.user.id}`, 6, 10 * 60_000);
    hit(`post-day:${req.user.id}`, 40, 86400_000);

    const image = req.file ? saveImage(uploadDir, req.file.buffer) : null;
    const now = Date.now();
    let id;
    try {
      id = tx(db, () => {
        const postId = Number(db.prepare(`INSERT INTO posts (board_id, user_id, body, image, flair, created_at, last_activity_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(board.id, req.user.id, body, image, flair, now, now).lastInsertRowid);
        db.prepare('INSERT INTO post_aliases (post_id, user_id, idx) VALUES (?, ?, 0)').run(postId, req.user.id);
        db.prepare('INSERT INTO follows (user_id, post_id) VALUES (?, ?)').run(req.user.id, postId);
        poll?.forEach((text, i) => db.prepare('INSERT INTO poll_options (post_id, idx, text) VALUES (?, ?, ?)').run(postId, i, text));
        // Authors start with their own upvote, like Sidechat and Reddit.
        db.prepare("INSERT INTO votes (user_id, kind, target_id, value, created_at) VALUES (?, 'post', ?, 1, ?)").run(req.user.id, postId, now);
        db.prepare('UPDATE posts SET upvotes = 1, score = 1 WHERE id = ?').run(postId);
        return postId;
      });
    } catch (err) {
      deleteImage(uploadDir, image);
      throw err;
    }
    const [post] = serializePosts(db, [loadPost(db, id, req.user)], req.user);
    res.status(201).json({ post });
  });

  r.get('/posts/:id', (req, res) => {
    const row = loadPost(db, req.params.id, req.user);
    const { access } = assertCanSee(db, req.user, row);
    const [post] = serializePosts(db, [row], req.user);
    const comments = commentsFor(db, row.id, req.user, req.query.sort);
    const mine = req.user ? db.prepare('SELECT idx FROM post_aliases WHERE post_id = ? AND user_id = ?').get(row.id, req.user.id) : null;
    res.json({
      post,
      comments,
      me: mine ? aliasFor(row.id, mine.idx) : null,
      canComment: !!req.user && access.member && !isBanned(req.user) && !row.locked && !row.removed_at,
      hiddenByVotes: row.score <= getSettings(db).autoHideScore,
    });
  });

  r.delete('/posts/:id', requireActive, (req, res) => {
    const row = loadPost(db, req.params.id, req.user);
    if (row.user_id !== req.user.id) throw forbidden('You can only delete your own posts.');
    db.prepare("UPDATE posts SET deleted_at = ?, body = '', image = NULL WHERE id = ?").run(Date.now(), row.id);
    db.prepare('DELETE FROM poll_options WHERE post_id = ?').run(row.id);
    deleteImage(uploadDir, row.image);
    res.json({ ok: true });
  });

  r.post('/posts/:id/vote', requireActive, (req, res) => {
    const value = readVote(req.body);
    const row = loadPost(db, req.params.id, req.user);
    const { access } = assertCanSee(db, req.user, row);
    assertCanParticipate(req.user, access);
    hit(`vote:${req.user.id}`, 300, 10 * 60_000);
    res.json(applyVote(db, 'post', row, req.user.id, value));
  });

  r.post('/posts/:id/poll', requireActive, (req, res) => {
    const row = loadPost(db, req.params.id, req.user);
    const { access } = assertCanSee(db, req.user, row);
    assertCanParticipate(req.user, access);
    const optionId = Number(req.body.optionId);
    const opt = db.prepare('SELECT * FROM poll_options WHERE id = ? AND post_id = ?').get(optionId, row.id);
    if (!opt) throw badRequest('That isn’t an option in this poll.');
    tx(db, () => {
      const prev = db.prepare('SELECT option_id FROM poll_votes WHERE post_id = ? AND user_id = ?').get(row.id, req.user.id);
      if (prev) throw badRequest('You already voted in this poll.');
      db.prepare('INSERT INTO poll_votes (post_id, user_id, option_id) VALUES (?, ?, ?)').run(row.id, req.user.id, optionId);
      db.prepare('UPDATE poll_options SET votes = votes + 1 WHERE id = ?').run(optionId);
    });
    const [post] = serializePosts(db, [loadPost(db, row.id, req.user)], req.user);
    res.json({ poll: post.poll });
  });

  const toggle = (name, fn) => r.post(`/posts/:id/${name}`, requireActive, (req, res) => {
    const row = loadPost(db, req.params.id, req.user);
    assertCanSee(db, req.user, row);
    const on = req.body.on !== false;
    fn(row, on, req.user.id);
    res.json({ ok: true, on });
  });

  toggle('save', (row, on, uid) => {
    if (on) db.prepare('INSERT OR IGNORE INTO saves (user_id, post_id, created_at) VALUES (?, ?, ?)').run(uid, row.id, Date.now());
    else db.prepare('DELETE FROM saves WHERE user_id = ? AND post_id = ?').run(uid, row.id);
  });
  toggle('hide', (row, on, uid) => {
    if (on) db.prepare('INSERT OR IGNORE INTO hides (user_id, post_id) VALUES (?, ?)').run(uid, row.id);
    else db.prepare('DELETE FROM hides WHERE user_id = ? AND post_id = ?').run(uid, row.id);
  });
  // on=true follows the thread; on=false mutes it, which also silences
  // direct replies, so it works for the OP as well.
  toggle('follow', (row, on, uid) => {
    db.prepare(`INSERT INTO follows (user_id, post_id, muted) VALUES (?, ?, ?)
      ON CONFLICT(user_id, post_id) DO UPDATE SET muted = excluded.muted`).run(uid, row.id, on ? 0 : 1);
  });

  r.post('/posts/:id/comments', requireActive, (req, res) => {
    const row = loadPost(db, req.params.id, req.user);
    const { access } = assertCanSee(db, req.user, row);
    assertCanParticipate(req.user, access);
    if (row.locked) throw forbidden('This thread is locked.');
    if (row.removed_at || row.deleted_at) throw forbidden('You can’t comment on this post.');
    const body = cleanText(req.body.body, { field: 'Your comment', max: 1000 });
    checkContent(db, body);
    let parent = null;
    if (req.body.parentId) {
      parent = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(Number(req.body.parentId), row.id);
      if (!parent) throw badRequest('That comment no longer exists.');
      if (parent.deleted_at || parent.removed_at) throw badRequest('You can’t reply to a deleted comment.');
    }
    hit(`comment:${req.user.id}`, 15, 5 * 60_000);
    hit(`comment-day:${req.user.id}`, 300, 86400_000);
    const now = Date.now();
    const comment = tx(db, () => {
      const alias = { idx: ensureAlias(db, row.id, req.user.id) };
      const id = Number(db.prepare(`INSERT INTO comments (post_id, parent_id, user_id, alias_idx, body, created_at, upvotes, score)
        VALUES (?, ?, ?, ?, ?, ?, 1, 1)`).run(row.id, parent?.id ?? null, req.user.id, alias.idx, body, now).lastInsertRowid);
      db.prepare("INSERT INTO votes (user_id, kind, target_id, value, created_at) VALUES (?, 'comment', ?, 1, ?)").run(req.user.id, id, now);
      db.prepare('UPDATE posts SET comment_count = comment_count + 1, last_activity_at = ? WHERE id = ?').run(now, row.id);
      const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
      onNewComment(db, { post: row, comment: c, parent, authorId: req.user.id });
      return c;
    });
    comment.my_vote = 1;
    res.status(201).json({ comment: serializeComment(comment, req.user, isStaff(req.user)) });
  });

  r.delete('/comments/:id', requireActive, (req, res) => {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound();
    if (c.user_id !== req.user.id) throw forbidden('You can only delete your own comments.');
    if (!c.deleted_at) {
      db.prepare("UPDATE comments SET deleted_at = ?, body = '' WHERE id = ?").run(Date.now(), c.id);
      db.prepare('UPDATE posts SET comment_count = MAX(0, comment_count - 1) WHERE id = ?').run(c.post_id);
    }
    res.json({ ok: true });
  });

  r.post('/comments/:id/vote', requireActive, (req, res) => {
    const value = readVote(req.body);
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(req.params.id));
    if (!c || c.deleted_at) throw notFound();
    const row = loadPost(db, c.post_id, req.user);
    const { access } = assertCanSee(db, req.user, row);
    assertCanParticipate(req.user, access);
    hit(`vote:${req.user.id}`, 300, 10 * 60_000);
    res.json(applyVote(db, 'comment', c, req.user.id, value));
  });

  // Staff tools that act on a single post.
  r.post('/posts/:id/pin', requireActive, (req, res) => {
    if (!isStaff(req.user)) throw forbidden();
    const row = loadPost(db, req.params.id, req.user);
    const on = req.body.on !== false;
    db.prepare('UPDATE posts SET pinned = ? WHERE id = ?').run(on ? 1 : 0, row.id);
    logAction(db, req.user.id, on ? 'pin' : 'unpin', 'post', row.id);
    res.json({ ok: true, on });
  });

  r.post('/posts/:id/lock', requireActive, (req, res) => {
    if (!isStaff(req.user)) throw forbidden();
    const row = loadPost(db, req.params.id, req.user);
    const on = req.body.on !== false;
    db.prepare('UPDATE posts SET locked = ? WHERE id = ?').run(on ? 1 : 0, row.id);
    logAction(db, req.user.id, on ? 'lock' : 'unlock', 'post', row.id);
    res.json({ ok: true, on });
  });

  return r;
}
