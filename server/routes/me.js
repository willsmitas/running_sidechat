import { Router } from 'express';
import config from '../config.js';
import { tx } from '../db.js';
import { verifyPassword } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { isBanned, isStaff } from '../lib/access.js';
import { deleteImage } from '../lib/images.js';
import { getSettings } from '../lib/settings.js';
import { POST_SELECT, serializePosts } from '../lib/serialize.js';
import { aliasFor } from '../lib/aliases.js';
import { destroySession, requireUser } from '../lib/session.js';

const PAGE = 25;

export function unreadCounts(db, userId) {
  const notifications = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
  const chats = db.prepare(`SELECT COUNT(*) AS n FROM conversations c WHERE
      (c.starter_id = @u AND c.last_message_at > c.starter_read_at OR c.recipient_id = @u AND c.last_message_at > c.recipient_read_at)
      AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != @u
        AND m.created_at > CASE WHEN c.starter_id = @u THEN c.starter_read_at ELSE c.recipient_read_at END)`).get({ u: userId }).n;
  const pendingReports = 0;
  return { notifications, chats, pendingReports };
}

// Karma is the net of votes other people gave your posts and comments, so
// your own automatic upvote on everything you write doesn't count.
export function karmaFor(db, userId) {
  const tally = (kind, table) => db.prepare(`SELECT
      COALESCE(SUM(v.value = 1), 0) AS up, COALESCE(SUM(v.value = -1), 0) AS down
    FROM votes v JOIN ${table} t ON t.id = v.target_id
    WHERE v.kind = '${kind}' AND t.user_id = @u AND v.user_id != @u AND t.deleted_at IS NULL`).get({ u: userId });
  const p = tally('post', 'posts');
  const c = tally('comment', 'comments');
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = @u AND deleted_at IS NULL) AS posts,
      (SELECT COUNT(*) FROM comments WHERE user_id = @u AND deleted_at IS NULL) AS comments`).get({ u: userId });
  return {
    total: p.up - p.down + c.up - c.down,
    posts: p.up - p.down,
    comments: c.up - c.down,
    upvotes: p.up + c.up,
    downvotes: p.down + c.down,
    postCount: counts.posts,
    commentCount: counts.comments,
  };
}

export default function meRoutes(db) {
  const r = Router();

  r.get('/me', (req, res) => {
    const settings = getSettings(db);
    const site = { name: config.appName, announcement: settings.announcement, publicRead: settings.publicReadWithoutAccount };
    if (!req.user) return res.json({ user: null, site });
    const u = req.user;
    const karma = karmaFor(db, u.id);
    const counts = unreadCounts(db, u.id);
    if (isStaff(u)) counts.pendingReports = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n
      + db.prepare("SELECT COUNT(*) AS n FROM verification_requests WHERE status = 'pending'").get().n;
    const pending = db.prepare(`SELECT s.name AS school FROM verification_requests vr JOIN schools s ON s.id = vr.school_id
      WHERE vr.user_id = ? AND vr.status = 'pending'`).get(u.id);
    res.json({
      site,
      user: {
        role: u.role,
        createdAt: u.created_at,
        karma,
        banned: isBanned(u) ? { until: u.banned_until, reason: u.ban_reason } : null,
        college: u.college,
        pendingCollege: pending ? pending.school : null,
        unread: counts,
      },
    });
  });

  r.get('/me/posts', requireUser, (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = db.prepare(`${POST_SELECT} WHERE p.user_id = @uid AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT @limit OFFSET @offset`)
      .all({ uid: req.user.id, limit: PAGE + 1, offset });
    res.json({ posts: serializePosts(db, rows.slice(0, PAGE), req.user), nextOffset: rows.length > PAGE ? offset + PAGE : null });
  });

  r.get('/me/saved', requireUser, (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = db.prepare(`${POST_SELECT} WHERE s.post_id IS NOT NULL AND p.deleted_at IS NULL AND p.removed_at IS NULL
      ORDER BY s.created_at DESC LIMIT @limit OFFSET @offset`).all({ uid: req.user.id, limit: PAGE + 1, offset });
    res.json({ posts: serializePosts(db, rows.slice(0, PAGE), req.user), nextOffset: rows.length > PAGE ? offset + PAGE : null });
  });

  r.get('/me/comments', requireUser, (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rows = db.prepare(`SELECT c.id, c.post_id, c.body, c.score, c.created_at, c.alias_idx, c.removed_at, p.body AS post_body,
        b.slug AS board_slug, b.name AS board_name, b.emoji AS board_emoji
      FROM comments c JOIN posts p ON p.id = c.post_id JOIN boards b ON b.id = p.board_id
      WHERE c.user_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(req.user.id, PAGE + 1, offset);
    res.json({
      comments: rows.slice(0, PAGE).map((c) => ({
        id: c.id, postId: c.post_id, body: c.body, score: c.score, createdAt: c.created_at, removed: !!c.removed_at,
        author: aliasFor(c.post_id, c.alias_idx), postSnippet: c.post_body.slice(0, 120),
        board: { slug: c.board_slug, name: c.board_name, emoji: c.board_emoji },
      })),
      nextOffset: rows.length > PAGE ? offset + PAGE : null,
    });
  });

  r.get('/notifications', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT n.*, p.board_id FROM notifications n LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`).all(req.user.id);
    res.json({
      notifications: rows.map((n) => ({
        id: n.id, type: n.type, postId: n.post_id, commentId: n.comment_id, text: n.text, count: n.count,
        createdAt: n.created_at, read: !!n.read_at,
      })),
    });
  });

  r.post('/notifications/read', requireUser, (req, res) => {
    const now = Date.now();
    if (Array.isArray(req.body.ids) && req.body.ids.length) {
      const ids = req.body.ids.map(Number).filter(Number.isInteger).slice(0, 200);
      db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.join(',') || 0})`).run(now, req.user.id);
    } else {
      db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, req.user.id);
    }
    res.json({ ok: true });
  });

  r.delete('/notifications', requireUser, (req, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  // Deleting an account removes the login, college link, votes, and chats.
  // With deleteContent, every post and comment is wiped too; otherwise they
  // stay up, already anonymous, with no link back to anyone.
  r.post('/me/delete', requireUser, (req, res) => {
    if (!verifyPassword(String(req.body.password ?? ''), req.user.password_hash)) throw badRequest('Wrong password.');
    const uid = req.user.id;
    const images = [];
    tx(db, () => {
      if (req.body.deleteContent) {
        for (const p of db.prepare('SELECT id, image FROM posts WHERE user_id = ?').all(uid)) if (p.image) images.push(p.image);
        db.prepare("UPDATE posts SET deleted_at = ?, body = '', image = NULL WHERE user_id = ?").run(Date.now(), uid);
        db.prepare("UPDATE comments SET deleted_at = ?, body = '' WHERE user_id = ?").run(Date.now(), uid);
      }
      db.prepare('DELETE FROM votes WHERE user_id = ?').run(uid);
      db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    });
    images.forEach((i) => deleteImage(config.uploadDir, i));
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  return r;
}
