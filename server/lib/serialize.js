import { aliasFor } from './aliases.js';
import { isStaff } from './access.js';

export function boardSummary(b) {
  return { id: b.id, slug: b.slug, name: b.name, emoji: b.emoji, kind: b.kind, division: b.division ?? null };
}

const POST_SELECT = `
  SELECT p.*, b.slug AS b_slug, b.name AS b_name, b.emoji AS b_emoji, b.kind AS b_kind, b.division AS b_division,
         v.value AS my_vote, (s.post_id IS NOT NULL) AS saved, f.muted AS follow_muted, (f.user_id IS NOT NULL) AS following
  FROM posts p
  JOIN boards b ON b.id = p.board_id
  LEFT JOIN votes v ON v.user_id = @uid AND v.kind = 'post' AND v.target_id = p.id
  LEFT JOIN saves s ON s.user_id = @uid AND s.post_id = p.id
  LEFT JOIN follows f ON f.user_id = @uid AND f.post_id = p.id`;

export { POST_SELECT };

export function serializePosts(db, rows, user) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const optRows = db.prepare(`SELECT * FROM poll_options WHERE post_id IN (${ids.join(',')}) ORDER BY post_id, idx`).all();
  const myPoll = user
    ? new Map(db.prepare(`SELECT post_id, option_id FROM poll_votes WHERE user_id = ? AND post_id IN (${ids.join(',')})`).all(user.id).map((r) => [r.post_id, r.option_id]))
    : new Map();
  const polls = new Map();
  for (const o of optRows) {
    if (!polls.has(o.post_id)) polls.set(o.post_id, []);
    polls.get(o.post_id).push({ id: o.id, text: o.text, votes: o.votes });
  }
  const staff = isStaff(user);
  return rows.map((p) => {
    const options = polls.get(p.id);
    const myOption = myPoll.get(p.id) ?? null;
    const isMine = !!user && p.user_id === user.id;
    const showPoll = options && (myOption || isMine);
    const out = {
      id: p.id,
      board: { slug: p.b_slug, name: p.b_name, emoji: p.b_emoji, kind: p.b_kind, division: p.b_division },
      body: p.body,
      image: p.image ? `/uploads/${p.image}` : null,
      flair: p.flair,
      createdAt: p.created_at,
      lastActivityAt: p.last_activity_at,
      score: p.score,
      commentCount: p.comment_count,
      myVote: p.my_vote ?? 0,
      saved: !!p.saved,
      following: !!p.following && !p.follow_muted,
      muted: !!p.follow_muted,
      isMine,
      pinned: !!p.pinned,
      locked: !!p.locked,
      author: aliasFor(p.id, 0),
      poll: options
        ? {
            options: options.map((o) => ({ id: o.id, text: o.text, votes: showPoll ? o.votes : null })),
            total: showPoll ? options.reduce((a, o) => a + o.votes, 0) : null,
            myVote: myOption,
          }
        : null,
    };
    if (p.removed_at) {
      out.removed = true;
      out.removalReason = p.removal_reason;
    }
    if (staff) out.mod = { authorId: p.user_id, reportCount: p.report_count, removedAt: p.removed_at, upvotes: p.upvotes, downvotes: p.downvotes };
    return out;
  });
}

export function serializeComment(c, user, staff) {
  const gone = c.deleted_at || (c.removed_at && !staff);
  const out = {
    id: c.id,
    postId: c.post_id,
    parentId: c.parent_id,
    body: gone ? '' : c.body,
    deleted: !!c.deleted_at,
    removed: !!c.removed_at,
    createdAt: c.created_at,
    score: c.score,
    myVote: c.my_vote ?? 0,
    isMine: !!user && c.user_id === user.id,
    author: gone ? null : aliasFor(c.post_id, c.alias_idx),
  };
  if (staff) out.mod = { authorId: c.user_id, reportCount: c.report_count, removalReason: c.removal_reason };
  return out;
}
