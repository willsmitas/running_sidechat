import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { fullDate, prepareImage, timeAgo } from '../util.js';
import Alias from './Alias.jsx';
import Vote from './Vote.jsx';
import Menu from './Menu.jsx';
import Linkify from './Linkify.jsx';
import ReportDialog from './ReportDialog.jsx';
import ModActions from './ModActions.jsx';
import Icon from './Icon.jsx';
import GifPicker from './GifPicker.jsx';

export function CommentBox({ postId, parentId = null, me, onPosted, autoFocus = false, onCancel, placeholder }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // At most one attachment: { kind: 'image', file, preview } or { kind: 'gif', gif }.
  const [media, setMedia] = useState(null);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef(null);
  const { site } = useSession();
  const toast = useToast();
  const ready = body.trim() || media;

  async function pickImage(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const file = await prepareImage(f);
    if (file.size > 6 * 1024 * 1024) return toast('Images must be under 6 MB.', 'error');
    setMedia({ kind: 'image', file, preview: URL.createObjectURL(file) });
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      let payload = { body, parentId };
      if (media?.kind === 'image') {
        payload = new FormData();
        payload.append('body', body);
        if (parentId) payload.append('parentId', parentId);
        payload.append('image', media.file);
      } else if (media?.kind === 'gif') {
        payload.gifId = media.gif.id;
      }
      const r = await post(`/posts/${postId}/comments`, payload);
      setBody('');
      setMedia(null);
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
      {media && (
        <div className="comment-attach-row">
          <div className="comment-attach">
            <img src={media.kind === 'image' ? media.preview : media.gif.url} alt="Attachment preview" referrerPolicy="no-referrer" />
            <button type="button" className="icon-btn" onClick={() => setMedia(null)} aria-label="Remove attachment"><Icon name="close" size={16} /></button>
          </div>
        </div>
      )}
      <div className="comment-box-actions">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        <button type="button" className="icon-btn" onClick={() => fileRef.current.click()} aria-label="Add image or GIF file" title="Add image"><Icon name="image" size={18} /></button>
        {site.gifs && <button type="button" className="gif-btn" onClick={() => setPicking(true)} aria-label="Search GIFs" title="Search GIFs">GIF</button>}
        <span className="spacer" />
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary btn-sm" disabled={busy || !ready}>{busy ? '…' : 'Post'}</button>
      </div>
      {picking && <GifPicker onClose={() => setPicking(false)} onPick={(gif) => { setMedia({ kind: 'gif', gif }); setPicking(false); }} />}
    </form>
  );
}

function CommentMedia({ c }) {
  if (c.image) {
    return (
      <a href={c.image} target="_blank" rel="noreferrer" className="comment-media">
        <img src={c.image} alt="" loading="lazy" />
      </a>
    );
  }
  if (c.gif) {
    return (
      <div className="comment-media">
        <img src={c.gif.url} alt="GIF" loading="lazy" referrerPolicy="no-referrer" />
      </div>
    );
  }
  return null;
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
          setState({ ...state, deleted: true, body: '', author: null, image: null, gif: null });
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
          {(state.body || gone || state.removed) && (
            <div className="comment-body">
              {state.deleted ? <span className="muted">[deleted]</span>
                : state.removed && !isStaff ? <span className="muted">[removed by moderators]</span>
                  : <Linkify text={state.body} />}
              {state.removed && isStaff && <span className="tag tag-removed">removed</span>}
            </div>
          )}
          {!gone && <CommentMedia c={state} />}
          <div className="comment-actions">
            {!gone && <Vote kind="comment" id={state.id} score={state.score} upvotes={state.upvotes} downvotes={state.downvotes} myVote={state.myVote} horizontal disabled={!ctx.canComment && !ctx.member} />}
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
