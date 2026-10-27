// Notification fan-out. Unread notifications of the same type on the same
// thread are collapsed into one ("3 new comments on your post").

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export function snippet(text, n = 60) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function notify(db, { userId, type, postId = null, commentId = null, text, collapse = null }) {
  if (!userId) return;
  const muted = postId && db.prepare('SELECT muted FROM follows WHERE user_id = ? AND post_id = ?').get(userId, postId);
  if (muted?.muted) return;
  if (collapse) {
    const existing = db.prepare('SELECT id, count FROM notifications WHERE user_id = ? AND type = ? AND post_id IS ? AND read_at IS NULL').get(userId, type, postId);
    if (existing) {
      const count = existing.count + 1;
      db.prepare('UPDATE notifications SET count = ?, text = ?, comment_id = ?, created_at = ? WHERE id = ?')
        .run(count, collapse(count), commentId, Date.now(), existing.id);
      return;
    }
  }
  db.prepare('INSERT INTO notifications (user_id, type, post_id, comment_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, type, postId, commentId, text, Date.now());
}

export function onNewComment(db, { post, comment, parent, authorId }) {
  const notified = new Set([authorId]);
  const bodySnip = snippet(comment.body);
  if (parent && parent.user_id && !notified.has(parent.user_id)) {
    notified.add(parent.user_id);
    notify(db, {
      userId: parent.user_id, type: 'reply', postId: post.id, commentId: comment.id,
      text: `Reply to your comment: “${bodySnip}”`,
      collapse: (n) => `${n} new replies to your comments`,
    });
  }
  const followers = db.prepare('SELECT user_id FROM follows WHERE post_id = ? AND muted = 0').all(post.id);
  for (const { user_id } of followers) {
    if (notified.has(user_id)) continue;
    notified.add(user_id);
    const isOp = user_id === post.user_id;
    notify(db, {
      userId: user_id, type: isOp ? 'comment' : 'thread', postId: post.id, commentId: comment.id,
      text: isOp ? `New comment on your post: “${bodySnip}”` : `New comment in a thread you follow: “${bodySnip}”`,
      collapse: (n) => (isOp ? `${n} new comments on your post “${snippet(post.body, 40)}”` : `${n} new comments in “${snippet(post.body, 40)}”`),
    });
  }
}

export function onScoreChange(db, { kind, target, before, after }) {
  if (!target.user_id || after <= before) return;
  const hit = MILESTONES.find((m) => before < m && after >= m);
  if (!hit) return;
  const what = kind === 'post' ? 'Your post' : 'Your comment';
  notify(db, {
    userId: target.user_id, type: `${kind}_milestone`, postId: kind === 'post' ? target.id : target.post_id,
    commentId: kind === 'comment' ? target.id : null,
    text: `${what} hit ${hit} upvotes: “${snippet(target.body, 50)}”`,
  });
}
