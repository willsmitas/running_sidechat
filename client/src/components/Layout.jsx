import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useSession } from '../session.jsx';
import Icon from './Icon.jsx';

function Badge({ n }) {
  if (!n) return null;
  return <span className="badge">{n > 99 ? '99+' : n}</span>;
}

function Sidebar() {
  const { user, boards } = useSession();
  const starred = boards.filter((b) => b.starred && b.canView);
  const pub = boards.filter((b) => b.kind === 'public');
  const college = boards.filter((b) => b.kind !== 'public' && b.member);
  const link = (b) => (
    <NavLink key={b.slug} to={`/b/${b.slug}`} className="side-link">
      <span className="side-emoji" aria-hidden>{b.emoji}</span> <span className="side-name">{b.name}</span>
      {b.kind !== 'public' && <Icon name="lock" size={12} className="muted" />}
    </NavLink>
  );
  return (
    <nav className="sidebar" aria-label="Boards">
      <NavLink to="/" end className="side-link"><Icon name="home" size={18} /> Home</NavLink>
      {college.length > 0 && <NavLink to="/college" className="side-link"><Icon name="school" size={18} /> My college boards</NavLink>}
      <NavLink to="/boards" className="side-link"><Icon name="grid" size={18} /> All boards</NavLink>
      <NavLink to="/search" className="side-link"><Icon name="search" size={18} /> Search</NavLink>
      {starred.length > 0 && (<><div className="side-head">Starred</div>{starred.map(link)}</>)}
      <div className="side-head">Public</div>
      {pub.map(link)}
      <div className="side-head">College</div>
      {college.length ? college.map(link) : (
        <Link to={user ? '/verify-college' : '/signup'} className="side-cta">
          <Icon name="lock" size={14} /> {user ? 'Verify your .edu to unlock NCAA, division, and conference boards' : 'Sign up with your .edu to unlock college boards'}
        </Link>
      )}
      <div className="side-foot muted">
        <Link to="/rules">Rules</Link> · <Link to="/about">About & privacy</Link>
      </div>
    </nav>
  );
}

export default function Layout({ children }) {
  const { user, site } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const unread = user?.unread || {};
  const isStaff = user && (user.role === 'admin' || user.role === 'mod');
  const hideFab = ['/new', '/login', '/signup'].includes(loc.pathname) || loc.pathname.startsWith('/chats/');

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="logo" aria-label={`${site.name} home`}>
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>{site.name}</span>
        </Link>
        <form className="top-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }} role="search">
          <Icon name="search" size={16} className="muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts" aria-label="Search posts" />
        </form>
        <div className="top-actions">
          {user ? (
            <>
              {isStaff && (
                <NavLink to="/admin" className="icon-btn has-badge" aria-label="Moderation">
                  <Icon name="shield" /><Badge n={unread.pendingReports} />
                </NavLink>
              )}
              <NavLink to="/chats" className="icon-btn has-badge hide-mobile" aria-label="Chats"><Icon name="chat" /><Badge n={unread.chats} /></NavLink>
              <NavLink to="/notifications" className="icon-btn has-badge" aria-label="Notifications"><Icon name="bell" /><Badge n={unread.notifications} /></NavLink>
              <NavLink to="/me" className="icon-btn hide-mobile" aria-label="Your profile"><Icon name="user" /></NavLink>
              <Link to="/new" className="btn btn-primary btn-sm hide-mobile"><Icon name="plus" size={16} /> Post</Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
              <Link to="/signup" className="btn btn-primary btn-sm">Sign up</Link>
            </>
          )}
        </div>
      </header>
      {site.announcement && <div className="announcement">{site.announcement}</div>}
      {user?.banned && (
        <div className="announcement announcement-warn">
          Your account is suspended until {new Date(user.banned.until).toLocaleDateString()}{user.banned.reason ? `: ${user.banned.reason}` : ''}. You can read but not post.
        </div>
      )}
      <div className="shell">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      {user && !hideFab && <Link to="/new" className="fab" aria-label="New post"><Icon name="plus" size={26} /></Link>}
      <nav className="tabbar" aria-label="Primary">
        <NavLink to="/" end><Icon name="home" /><span>Home</span></NavLink>
        <NavLink to="/boards"><Icon name="grid" /><span>Boards</span></NavLink>
        <NavLink to={user ? '/chats' : '/login'} className="has-badge"><Icon name="chat" /><span>Chats</span><Badge n={unread.chats} /></NavLink>
        <NavLink to={user ? '/me' : '/login'}><Icon name="user" /><span>{user ? 'Me' : 'Log in'}</span></NavLink>
      </nav>
    </div>
  );
}
