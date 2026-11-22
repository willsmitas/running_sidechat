import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, post as apiPost } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { fullDate, timeAgo } from '../util.js';
import Icon from './Icon.jsx';
import Vote from './Vote.jsx';
import Poll from './Poll.jsx';
import Menu from './Menu.jsx';
import Linkify from './Linkify.jsx';
import ReportDialog from './ReportDialog.jsx';
import ModActions from './ModActions.jsx';

export default function PostCard({ post, showBoard = true, full = false, onRemoved, canParticipate = true }) {
  const [p, setP] = useState(post);
  const [reporting, setReporting] = useState(false);
  const [gone, setGone] = useState(false);
  const [expanded, setExpanded] = useState(full);
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  if (gone) return null;

  const isStaff = user && (user.role === 'admin' || user.role === 'mod');
  const long = !full && p.body.length > 420;
  const open = () => !full && nav(`/p/${p.id}`);

  const toggle = async (what, key) => {
    if (!user) return nav('/login');
    const on = !p[key];
    try {
      await apiPost(`/posts/${p.id}/${what}`, { on });
      setP({ ...p, [key]: on });
      if (what === 'save') toast(on ? 'Saved' : 'Removed from saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  async function share() {
    const url = `${location.origin}/p/${p.id}`;
    try {
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch { /* cancelled */ }
  }

  const items = [
    { label: p.saved ? 'Unsave' : 'Save', icon: 'star', onClick: () => toggle('save', 'saved'), hidden: !user },
    { label: p.muted ? 'Unmute notifications' : 'Mute notifications', icon: 'mute', onClick: async () => {
      const on = p.muted; // following again == unmute
      await apiPost(`/posts/${p.id}/follow`, { on });
      setP({ ...p, muted: !on, following: on });
      toast(on ? 'Notifications on' : 'Thread muted');
    }, hidden: !user },
    { label: 'Hide', icon: 'close', onClick: async () => { await toggle('hide', 'hidden'); setGone(true); onRemoved?.(p.id); }, hidden: !user || full || p.isMine },
    { label: 'Report', icon: 'flag', onClick: () => (user ? setReporting(true) : nav('/login')), hidden: p.isMine },
    {
      label: 'Delete', icon: 'trash', danger: true, hidden: !p.isMine,
      onClick: async () => {
        if (!confirm('Delete this post for everyone? This can’t be undone.')) return;
        try {
          await del(`/posts/${p.id}`);
          toast('Post deleted');
          if (full) nav(-1);
          else { setGone(true); onRemoved?.(p.id); }
        } catch (err) { toast(err.message, 'error'); }
      },
    },
  ];

  return (
    <article className={`card post ${full ? 'post-full' : 'clickable'} ${p.removed ? 'is-removed' : ''}`} onClick={open}>
      <div className="post-main">
        <div className="post-meta">
          {showBoard && (
            <Link to={`/b/${p.board.slug}`} className="chip" onClick={(e) => e.stopPropagation()}>
              <span aria-hidden>{p.board.emoji}</span> {p.board.name}
            </Link>
          )}
          {p.flair && <span className="flair" title="Verified via college email">✓ {p.flair}</span>}
          {p.pinned && <span className="tag tag-pin"><Icon name="pin" size={12} /> Pinned</span>}
          {p.locked && <span className="tag"><Icon name="lock" size={12} /> Locked</span>}
          <time className="muted" dateTime={new Date(p.createdAt).toISOString()} title={fullDate(p.createdAt)}>{timeAgo(p.createdAt)}</time>
          {p.isMine && <span className="tag tag-you">You</span>}
        </div>
        {p.removed && <div className="callout callout-warn">Removed: {p.removalReason || 'by moderators'}. Only you{isStaff ? ' and staff' : ''} can see this.</div>}
        <div className={`post-body ${long && !expanded ? 'clamp' : ''}`}><Linkify text={p.body} /></div>
        {long && !expanded && (
          <button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setExpanded(true); }}>Read more</button>
        )}
        {p.image && (
          <a href={p.image} target="_blank" rel="noreferrer" className="post-image" onClick={(e) => e.stopPropagation()}>
            <img src={p.image} alt="" loading="lazy" />
          </a>
        )}
        {p.poll && <Poll postId={p.id} poll={p.poll} canVote={canParticipate} />}
        <div className="post-actions">
          {!full && (
            <Link to={`/p/${p.id}`} className="action" onClick={(e) => e.stopPropagation()}>
              <Icon name="comment" size={18} /> {p.commentCount || ''}
              <span className="sr-only">comments</span>
            </Link>
          )}
          <button type="button" className="action" onClick={(e) => { e.stopPropagation(); share(); }} aria-label="Share">
            <Icon name="share" size={18} />
          </button>
          {p.saved && <span className="action muted" title="Saved"><Icon name="star" size={16} /></span>}
          <span className="spacer" />
          {isStaff && <ModActions kind="post" target={p} onChange={(patch) => setP({ ...p, ...patch })} />}
          <Menu items={items} />
        </div>
      </div>
      <Vote kind="post" id={p.id} score={p.score} upvotes={p.upvotes} downvotes={p.downvotes} myVote={p.myVote} disabled={!canParticipate} />
      {reporting && <ReportDialog kind="post" id={p.id} onClose={() => setReporting(false)} />}
    </article>
  );
}
