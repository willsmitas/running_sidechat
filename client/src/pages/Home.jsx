import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '../session.jsx';
import Feed from '../components/Feed.jsx';
import SortBar from '../components/SortBar.jsx';
import Composer from '../components/Composer.jsx';
import Icon from '../components/Icon.jsx';
import { useTitle } from '../useTitle.js';

export default function Home({ scope = 'home' }) {
  const { user, boards } = useSession();
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') || 'hot';
  const t = params.get('t') || 'week';
  const [nonce, setNonce] = useNonce();
  useTitle(scope === 'college' ? 'College boards' : null);
  const hasCollege = boards.some((b) => b.kind !== 'public' && b.member);
  const hasStarred = boards.some((b) => b.starred);
  const feedScope = scope === 'home' ? params.get('feed') || 'home' : scope;

  return (
    <div className="page">
      {!user && (
        <div className="card hero">
          <h1>The anonymous home for distance running.</h1>
          <p>Talk splits, rumors, recruiting, and the meet results everyone’s arguing about — without your name on it. College athletes: sign up with your <strong>.edu</strong> to unlock private NCAA, division, and conference boards.</p>
          <div className="row">
            <Link to="/signup" className="btn btn-primary">Get started</Link>
            <Link to="/boards" className="btn btn-ghost">Browse boards</Link>
          </div>
        </div>
      )}
      {user && !user.college?.active && !user.pendingCollege && (
        <Link to="/verify-college" className="card nudge">
          <Icon name="school" size={22} />
          <div><strong>Run in college?</strong> Verify your school email to unlock the NCAA board, your division, and your conference.</div>
        </Link>
      )}
      {scope === 'home' && user && (hasCollege || hasStarred) && (
        <div className="tabs">
          <button className={feedScope === 'home' ? 'on' : ''} onClick={() => setParams({ sort, t })}>Everything</button>
          {hasCollege && <button className={feedScope === 'college' ? 'on' : ''} onClick={() => setParams({ feed: 'college', sort, t })}>College</button>}
          {hasStarred && <button className={feedScope === 'starred' ? 'on' : ''} onClick={() => setParams({ feed: 'starred', sort, t })}>Starred</button>}
        </div>
      )}
      {scope === 'college' && <h1 className="page-title">My college boards</h1>}
      {user && <Composer compact onPosted={() => setNonce()} defaultBoard={feedScope === 'college' ? boards.find((b) => b.kind === 'conference' && b.member)?.slug : undefined} />}
      <SortBar sort={sort} t={t} onChange={(v) => setParams({ ...Object.fromEntries(params), ...v })} />
      <Feed key={nonce} path={`/feed?board=${feedScope}&sort=${sort}&t=${t}`} />
    </div>
  );
}

function useNonce() {
  const [n, setN] = useState(0);
  return [n, () => setN((x) => x + 1)];
}
