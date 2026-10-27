import { Router } from 'express';
import { tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { boardAccess } from '../lib/access.js';
import { aliasFor } from '../lib/aliases.js';
import { cleanText, checkContent } from '../lib/content.js';
import { hit } from '../lib/ratelimit.js';
import { snippet } from '../lib/notify.js';
import { requireActive } from '../lib/session.js';
import { ensureAlias } from '../lib/threads.js';

// Anonymous one-to-one chats, started from a post or comment. Both sides keep
// the animal identity they have in that thread, so nobody learns who they're
// talking to.

function side(conv, userId) {
  if (conv.starter_id === userId) return { me: 'starter', myAlias: conv.starter_alias, theirAlias: conv.recipient_alias, readAt: conv.starter_read_at };
  if (conv.recipient_id === userId) return { me: 'recipient', myAlias: conv.recipient_alias, theirAlias: conv.starter_alias, readAt: conv.recipient_read_at };
  return null;
}

function loadConv(db, id, userId) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(id));
  if (!conv) throw notFound('Chat not found.');
  const s = side(conv, userId);
  if (!s) throw notFound('Chat not found.');
  return { conv, s };
}

function convJson(db, conv, userId) {
  const s = side(conv, userId);
  const postId = conv.post_id ?? 0;
  const last = db.prepare('SELECT body, sender_id, created_at, removed_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conv.id);
  const otherGone = s.me === 'starter' ? conv.recipient_id === null : conv.starter_id === null;
  return {
    id: conv.id,
    postId: conv.post_id,
    context: conv.context,
    me: aliasFor(postId, s.myAlias),
    them: aliasFor(postId, s.theirAlias),
    lastMessage: last ? { body: last.removed_at ? 'Message removed' : snippet(last.body, 80), mine: last.sender_id === userId, createdAt: last.created_at } : null,
    lastMessageAt: conv.last_message_at,
    unread: !!last && last.sender_id !== userId && last.created_at > s.readAt,
    blocked: !!conv.blocked_by,
    blockedByMe: conv.blocked_by === userId,
    otherLeft: otherGone,
  };
}

export default function chatRoutes(db) {
  const r = Router();

  r.get('/chats', requireActive, (req, res) => {
    const rows = db.prepare(`SELECT * FROM conversations WHERE (starter_id = @u OR recipient_id = @u)
      AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = conversations.id)
      ORDER BY last_message_at DESC LIMIT 100`).all({ u: req.user.id });
    res.json({ chats: rows.map((c) => convJson(db, c, req.user.id)) });
  });

  r.post('/chats', requireActive, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.body.postId));
    if (!post || post.deleted_at || post.removed_at) throw notFound('That post is gone.');
    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(post.board_id);
    const a = boardAccess(db, req.user, board);
    if (!a.member) throw forbidden('Only members of this board can start chats here.');

    let targetId = post.user_id;
    let context = `Re: “${snippet(post.body, 70)}”`;
    if (req.body.commentId) {
      const c = db.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').get(Number(req.body.commentId), post.id);
      if (!c || c.deleted_at || c.removed_at) throw notFound('That comment is gone.');
      targetId = c.user_id;
      context = `Re: “${snippet(c.body, 70)}”`;
    }
    if (!targetId) throw badRequest('That account no longer exists.');
    if (targetId === req.user.id) throw badRequest('That’s you!');

    const existing = db.prepare(`SELECT * FROM conversations WHERE post_id = @p AND
      ((starter_id = @me AND recipient_id = @them) OR (starter_id = @them AND recipient_id = @me))`).get({ p: post.id, me: req.user.id, them: targetId });
    if (existing) return res.json({ chat: convJson(db, existing, req.user.id) });

    hit(`chat-new:${req.user.id}`, 20, 86400_000);
    const id = tx(db, () => {
      const myAlias = ensureAlias(db, post.id, req.user.id);
      const theirAlias = ensureAlias(db, post.id, targetId);
      const now = Date.now();
      return Number(db.prepare(`INSERT INTO conversations (post_id, starter_id, recipient_id, starter_alias, recipient_alias, context, created_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(post.id, req.user.id, targetId, myAlias, theirAlias, context, now, now).lastInsertRowid);
    });
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    res.status(201).json({ chat: convJson(db, conv, req.user.id) });
  });

  r.get('/chats/:id', requireActive, (req, res) => {
    const { conv, s } = loadConv(db, req.params.id, req.user.id);
    const after = Number(req.query.after) || 0;
    const messages = db.prepare(`SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT 200) ORDER BY id`)
      .all(conv.id, after);
    db.prepare(`UPDATE conversations SET ${s.me}_read_at = ? WHERE id = ?`).run(Date.now(), conv.id);
    res.json({
      chat: convJson(db, conv, req.user.id),
      messages: messages.map((m) => ({
        id: m.id, mine: m.sender_id === req.user.id, body: m.removed_at ? '' : m.body, removed: !!m.removed_at, createdAt: m.created_at,
      })),
    });
  });

  r.post('/chats/:id/messages', requireActive, (req, res) => {
    const { conv } = loadConv(db, req.params.id, req.user.id);
    if (conv.blocked_by) throw forbidden(conv.blocked_by === req.user.id ? 'You blocked this chat. Unblock to send messages.' : 'You can’t send messages in this chat.');
    if (!conv.starter_id || !conv.recipient_id) throw forbidden('The other person left.');
    const body = cleanText(req.body.body, { field: 'Message', max: 1000 });
    checkContent(db, body, { contactInfo: false });
    hit(`chat-msg:${req.user.id}`, 40, 5 * 60_000);
    const now = Date.now();
    const side_ = conv.starter_id === req.user.id ? 'starter' : 'recipient';
    const id = tx(db, () => {
      const mid = Number(db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)').run(conv.id, req.user.id, body, now).lastInsertRowid);
      db.prepare(`UPDATE conversations SET last_message_at = ?, ${side_}_read_at = ? WHERE id = ?`).run(now, now, conv.id);
      return mid;
    });
    res.status(201).json({ message: { id, mine: true, body, createdAt: now } });
  });

  r.post('/chats/:id/block', requireActive, (req, res) => {
    const { conv } = loadConv(db, req.params.id, req.user.id);
    const on = req.body.on !== false;
    if (on) {
      if (!conv.blocked_by) db.prepare('UPDATE conversations SET blocked_by = ? WHERE id = ?').run(req.user.id, conv.id);
    } else if (conv.blocked_by === req.user.id) {
      db.prepare('UPDATE conversations SET blocked_by = NULL WHERE id = ?').run(conv.id);
    }
    res.json({ ok: true });
  });

  return r;
}
