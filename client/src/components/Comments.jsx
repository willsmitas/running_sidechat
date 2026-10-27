import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { fullDate, timeAgo } from '../util.js';
import Alias from './Alias.jsx';
import Vote from './Vote.jsx';
import Menu from './Menu.jsx';
import Linkify from './Linkify.jsx';
import ReportDialog from './ReportDialog.jsx';
import ModActions from './ModActions.jsx';

export function CommentBox({ postId, parentId = null, me, onPosted, autoFocus = false, onCancel, placeholder }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await post(`/posts/${postId}/comments`, { body, parentId });
      setBody('');
      onPosted(r.comment);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="comment-box" onSubmit={submit}>
      {me && <Alias alias={me} size="sm" showName={false} />}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder || (me ? `Comment as ${me.name}` : 'Add a comment — you’ll get an anonymous icon for this thread')}
        maxLength={1000}
        rows={body.length > 80 ? 4 : 1}
        autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
      />
      <div className="comment-box-actions">
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>{busy ? '…' : 'Post'}</button>
      </div>
    </form>
  );
}

function Comment({ c, children, depth, ctx }) {
  const [reply, setReply] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [state, setState] = useState(c);
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const isStaff = user && (user.role === 'admin' || user.role === 'mod');
  const gone = state.deleted || (state.removed && !isStaff);

  const items = [
    { label: 'Reply', icon: 'comment', hidden: !ctx.canComment || gone, onClick: () => setReply(true) },
    { label: 'Message', icon: 'chat', hidden: !user || state.isMine || gone || !ctx.canComment, onClick: () => ctx.startChat(state.id) },
    { label: 'Report', icon: 'flag', hidden: state.isMine || gone, onClick: () => (user ? setReporting(true) : nav('/login')) },
    {
      label: 'Delete', icon: 'trash', danger: true, hidden: !state.isMine || gone,
      onClick: async () => {
        if (!confirm('Delete this comment?')) return;
        try {
          await del(`/comments/${state.id}`);
          setState({ ...state, deleted: true, body: '', author: null });
        } catch (err) { toast(err.message, 'error'); }
      },
    },
  ];

  return (
    <div className={`comment depth-${Math.min(depth, 4)} ${state.removed ? 'is-removed' : ''}`} id={`c${state.id}`}>
      <div className="comment-head">
        <button type="button" className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand' : 'Collapse'}>
          <Alias alias={gone ? null : state.author} size="sm" />
        </button>
        {state.isMine && !gone && <span className="tag tag-you">You</span>}
        <time className="muted" title={fullDate(state.createdAt)}>{timeAgo(state.createdAt)}</time>
        {collapsed && <span className="muted">· {1 + (children?.length || 0)} hidden</span>}
      </div>
      {!collapsed && (
        <>
          <div className="comment-body">
            {state.deleted ? <span className="muted">[deleted]</span>
              : state.removed && !isStaff ? <span className="muted">[removed by moderators]</span>
                : <Linkify text={state.body} />}
            {state.removed && isStaff && <span className="tag tag-removed">removed</span>}
          </div>
          <div className="comment-actions">
            {!gone && <Vote kind="comment" id={state.id} score={state.score} myVote={state.myVote} horizontal disabled={!ctx.canComment && !ctx.member} />}
            {ctx.canComment && !gone && <button type="button" className="link-btn" onClick={() => setReply(!reply)}>Reply</button>}
            {isStaff && <ModActions kind="comment" target={state} onChange={(patch) => setState({ ...state, ...patch })} />}
            <Menu items={items} />
          </div>
          {reply && (
            <CommentBox postId={ctx.postId} parentId={state.id} me={ctx.me} autoFocus
              placeholder={`Reply to ${state.author?.name || 'comment'}`}
              onCancel={() => setReply(false)}
              onPosted={(nc) => { setReply(false); ctx.onPosted(nc); }} />
          )}
          {children?.length > 0 && <div className="comment-children">{children}</div>}
        </>
      )}
      {reporting && <ReportDialog kind="comment" id={state.id} onClose={() => setReporting(false)} />}
    </div>
  );
}

export default function Comments({ comments, ctx }) {
  const tree = useMemo(() => {
    const byParent = new Map();
    for (const c of comments) {
      const k = c.parentId ?? 0;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(c);
    }
    return byParent;
  }, [comments]);

  const render = (parent, depth) => (tree.get(parent) || []).map((c) => (
    <Comment key={c.id} c={c} depth={depth} ctx={ctx}>{render(c.id, depth + 1)}</Comment>
  ));

  if (!comments.length) return <div className="empty muted">No comments yet. Be the first.</div>;
  return <div className="comments">{render(0, 0)}</div>;
}
