import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session.jsx';
import Icon from '../components/Icon.jsx';
import { DIVISION_NAMES } from '../util.js';
import { useTitle } from '../useTitle.js';

function BoardRow({ b }) {
  return (
    <Link to={`/b/${b.slug}`} className={`board-row ${b.canView ? '' : 'is-locked'}`}>
      <span className="board-row-emoji" aria-hidden>{b.emoji}</span>
      <span className="board-row-main">
        <span className="board-row-name">{b.name}</span>
        {b.description && <span className="board-row-desc muted">{b.description}</span>}
      </span>
      {b.postsToday > 0 && b.canView && <span className="muted small">{b.postsToday} today</span>}
      {b.member && b.kind !== 'public' && <span className="tag tag-member">Member</span>}
      {!b.canView && <Icon name="lock" size={16} className="muted" />}
    </Link>
  );
}

export default function Boards() {
  const { boards, user } = useSession();
  const [q, setQ] = useState('');
  const [openDiv, setOpenDiv] = useState(() => (user?.college?.division ? { [user.college.division]: true } : { 1: true }));
  useTitle('Boards');
  const filter = (list) => (q ? list.filter((b) => `${b.name} ${b.description}`.toLowerCase().includes(q.toLowerCase())) : list);

  const groups = useMemo(() => ({
    public: boards.filter((b) => b.kind === 'public'),
    ncaa: boards.filter((b) => b.kind === 'ncaa' || b.kind === 'division'),
    conf: [1, 2, 3].map((d) => boards.filter((b) => b.kind === 'conference' && b.division === d)),
  }), [boards]);

  return (
    <div className="page">
      <h1 className="page-title">Boards</h1>
      <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a board or conference" aria-label="Filter boards" />

      <section>
        <h2 className="section-title">Public</h2>
        <p className="muted small">Open to everyone. Anonymous.</p>
        <div className="card list">{filter(groups.public).map((b) => <BoardRow key={b.slug} b={b} />)}</div>
      </section>

      <section>
        <h2 className="section-title"><Icon name="lock" size={16} /> College</h2>
        <p className="muted small">
          Private boards for NCAA athletes, verified with a school email.{' '}
          {!user?.college?.active && <Link to={user ? '/verify-college' : '/signup'}>Verify yours →</Link>}
          {' '}<Link to="/conferences">Is my school listed?</Link>
        </p>
        <div className="card list">{filter(groups.ncaa).map((b) => <BoardRow key={b.slug} b={b} />)}</div>
        {[1, 2, 3].map((d) => {
          const list = filter(groups.conf[d - 1]);
          if (!list.length) return null;
          const open = q || openDiv[d];
          return (
            <div key={d} className="conf-group">
              <button type="button" className="conf-toggle" onClick={() => setOpenDiv({ ...openDiv, [d]: !openDiv[d] })} aria-expanded={!!open}>
                <span>{DIVISION_NAMES[d]} conferences</span>
                <span className="muted">{list.length} {open ? '▴' : '▾'}</span>
              </button>
              {open && <div className="card list">{list.map((b) => <BoardRow key={b.slug} b={b} />)}</div>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
