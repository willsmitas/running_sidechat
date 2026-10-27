// Returns the user's per-thread alias index, assigning the next free one if
// they have none yet. Indexes are never reused, even ones freed by a deleted
// account, so two people never share an identity in a thread.
export function ensureAlias(db, postId, userId) {
  const existing = db.prepare('SELECT idx FROM post_aliases WHERE post_id = ? AND user_id = ?').get(postId, userId);
  if (existing) return existing.idx;
  const next = db.prepare(`SELECT MAX(COALESCE((SELECT MAX(idx) FROM post_aliases WHERE post_id = @p), 0),
    COALESCE((SELECT MAX(alias_idx) FROM comments WHERE post_id = @p), 0),
    COALESCE((SELECT MAX(MAX(starter_alias, recipient_alias)) FROM conversations WHERE post_id = @p), 0)) + 1 AS n`).get({ p: postId }).n;
  db.prepare('INSERT INTO post_aliases (post_id, user_id, idx) VALUES (?, ?, ?)').run(postId, userId, next);
  return next;
}
