import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { del, get, post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import Feed from '../components/Feed.jsx';
import Alias from '../components/Alias.jsx';
import Spinner from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';
import { DIVISION_NAMES, timeAgo } from '../util.js';
import { useTitle } from '../useTitle.js';

function MyComments() {
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const load = (offset) => get(`/me/comments?offset=${offset}`).then((r) => { setItems((cur) => [...(offset ? cur : []), ...r.comments]); setNext(r.nextOffset); });
  useEffect(() => { load(0); }, []);
  if (!items) return <Spinner />;
  if (!items.length) return <div className="card empty">You haven’t commented yet.</div>;
  return (
    <div className="card list">
      {items.map((c) => (
        <Link key={c.id} to={`/p/${c.postId}#c${c.id}`} className="my-comment">
          <div className="small muted">{c.board.emoji} {c.board.name} · on “{c.postSnippet}” · {timeAgo(c.createdAt)}</div>
          <div className="row-gap"><Alias alias={c.author} size="sm" showName={false} /> <span>{c.body}</span></div>
          <div className="small muted">{c.score} points {c.removed && <span className="tag tag-removed">removed</span>}</div>
        </Link>
      ))}
      {next && <button className="btn btn-ghost btn-block" onClick={() => load(next)}>Load more</button>}
    </div>
  );
}

function Settings() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [delPw, setDelPw] = useState('');
  const [purge, setPurge] = useState(false);

  return (
    <div className="stack">
      <div className="card">
        <h3>College</h3>
        {user.college ? (
          <>
            <p>{user.college.active ? '✅' : '⚠️'} <strong>{user.college.schoolName}</strong> · {user.college.conferenceShort} · {DIVISION_NAMES[user.college.division]}</p>
            <p className="muted small">{user.college.active ? `Verified until ${new Date(user.college.expiresAt).toLocaleDateString()}.` : 'Expired — re-verify to regain access.'} Only you can see this.</p>
            <div className="row">
              <Link to="/verify-college" className="btn btn-ghost btn-sm">{user.college.active ? 'Change school' : 'Re-verify'}</Link>
              <button className="btn btn-ghost btn-sm danger" onClick={async () => {
                if (!confirm('Remove your college verification? You’ll lose access to college boards.')) return;
                await del('/college'); await refresh(); toast('College verification removed');
              }}>Remove</button>
            </div>
          </>
        ) : (
          <p><Link to="/verify-college">Verify your school email</Link> to unlock NCAA, division, and conference boards.{user.pendingCollege && ` (Pending: ${user.pendingCollege})`}</p>
        )}
      </div>

      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await post('/auth/change-password', { current: cur, next }); setCur(''); setNext(''); toast('Password changed. Other devices were logged out.'); }
        catch (err) { toast(err.message, 'error'); }
      }}>
        <h3>Change password</h3>
        <input type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        <button className="btn btn-primary btn-sm">Update password</button>
      </form>

      <div className="card stack">
        <h3>Sessions</h3>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={async () => { await post('/auth/logout'); await refresh(); nav('/'); }}>Log out</button>
          <button className="btn btn-ghost btn-sm" onClick={async () => { await post('/auth/logout-everywhere'); await refresh(); nav('/'); }}>Log out everywhere</button>
        </div>
      </div>

      <form className="card stack danger-zone" onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm(purge ? 'Delete your account AND everything you’ve posted? This can’t be undone.' : 'Delete your account? Your posts stay up anonymously.')) return;
        try { await post('/me/delete', { password: delPw, deleteContent: purge }); await refresh(); toast('Account deleted'); nav('/'); }
        catch (err) { toast(err.message, 'error'); }
      }}>
        <h3>Delete account</h3>
        <p className="muted small">Removes your login, college link, votes, and chats. Your posts are already anonymous; choose whether to wipe them too.</p>
        <label className="check"><input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} /> Also delete all my posts and comments</label>
        <input type="password" placeholder="Password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} required />
        <button className="btn btn-danger btn-sm">Delete account</button>
      </form>
    </div>
  );
}

export default function Me() {
  const { user, loading } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'posts';
  useTitle('You');
  if (loading) return <div className="page"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="page">
      <div className="card profile">
        <div className="profile-icon"><Icon name="user" size={28} /></div>
        <div>
          <div className="profile-karma"><strong>{user.karma}</strong> karma</div>
          <div className="muted small">
            Joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            {user.college?.active && <> · ✓ {user.college.conferenceShort} · D{'I'.repeat(user.college.division)}</>}
            {user.role !== 'user' && <> · <span className="tag">{user.role}</span></>}
          </div>
          <div className="muted small">Your profile is private. Nobody else can see your posts listed together.</div>
        </div>
      </div>
      <div className="tabs">
        {[['posts', 'Posts'], ['comments', 'Comments'], ['saved', 'Saved'], ['settings', 'Settings']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setParams({ tab: k })}>{label}</button>
        ))}
      </div>
      {tab === 'posts' && <Feed path="/me/posts" empty={<div className="card empty">You haven’t posted yet. <Link to="/new">Write something</Link>.</div>} />}
      {tab === 'comments' && <MyComments />}
      {tab === 'saved' && <Feed path="/me/saved" empty={<div className="card empty">Save posts from the ⋯ menu to find them here.</div>} />}
      {tab === 'settings' && <Settings />}
    </div>
  );
}
