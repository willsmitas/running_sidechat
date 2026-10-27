import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post as apiPost } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import PostCard from '../components/PostCard.jsx';
import Comments, { CommentBox } from '../components/Comments.jsx';
import Locked from '../components/Locked.jsx';
import Spinner from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';
import { useTitle } from '../useTitle.js';

export default function Post() {
  const { id } = useParams();
  const { user, refreshMe } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('old');
  useTitle(data ? data.post.body.slice(0, 50) : 'Post');

  const load = useCallback(() => {
    get(`/posts/${id}?sort=${sort}`).then((d) => { setData(d); setError(null); }).catch(setError);
  }, [id, sort]);
  useEffect(load, [load]);

  // Jump to a comment linked from a notification (#c123).
  useEffect(() => {
    if (!data || !location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
    }
  }, [data]);

  useEffect(() => { if (user?.unread?.notifications) refreshMe(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startChat = useCallback(async (commentId) => {
    try {
      const r = await apiPost('/chats', { postId: Number(id), commentId });
      nav(`/chats/${r.chat.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [id, nav, toast]);

  if (error) {
    if (error.status === 403 && error.data.locked) return <div className="page"><Locked reason={error.data.reason} message={error.message} /></div>;
    return <div className="page"><div className="card empty">{error.message}<br /><Link to="/">Back home</Link></div></div>;
  }
  if (!data) return <div className="page"><Spinner /></div>;

  const { post: p, comments, me, canComment } = data;
  const ctx = {
    postId: p.id,
    me,
    canComment,
    member: canComment,
    startChat,
    onPosted: (c) => setData((d) => ({ ...d, me: d.me || c.author, comments: [...d.comments, c], post: { ...d.post, commentCount: d.post.commentCount + 1 } })),
  };

  return (
    <div className="page">
      <button type="button" className="back-btn" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><Icon name="back" size={18} /> Back</button>
      {data.hiddenByVotes && <div className="callout callout-warn">This post was downvoted below the visibility threshold and is hidden from feeds.</div>}
      <PostCard key={p.id} post={p} full canParticipate={canComment || !!p.isMine} />
      <div className="card thread">
        <div className="thread-head">
          <h2>{p.commentCount} comment{p.commentCount === 1 ? '' : 's'}</h2>
          <span className="spacer" />
          {user && !p.isMine && canComment && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => startChat()}><Icon name="chat" size={16} /> Message OP</button>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort comments">
            <option value="old">Oldest</option>
            <option value="new">Newest</option>
            <option value="top">Top</option>
          </select>
        </div>
        {canComment ? (
          <CommentBox postId={p.id} me={me} onPosted={ctx.onPosted} />
        ) : !user ? (
          <p className="muted"><Link to="/login">Log in</Link> or <Link to="/signup">sign up</Link> to comment.</p>
        ) : p.locked ? (
          <p className="muted"><Icon name="lock" size={14} /> This thread is locked.</p>
        ) : null}
        <Comments comments={comments} ctx={ctx} />
      </div>
    </div>
  );
}
