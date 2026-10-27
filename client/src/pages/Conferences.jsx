import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api.js';
import Spinner from '../components/Spinner.jsx';
import { DIVISION_NAMES } from '../util.js';
import { useTitle } from '../useTitle.js';

// Public directory of every conference and school we can verify.
export default function Conferences() {
  const [confs, setConfs] = useState(null);
  const [q, setQ] = useState('');
  useTitle('Schools & conferences');
  useEffect(() => { get('/conferences').then((r) => setConfs(r.conferences)); }, []);
  if (!confs) return <div className="page"><Spinner /></div>;
  const needle = q.toLowerCase();
  const shown = confs
    .map((c) => ({ ...c, schools: needle && !c.name.toLowerCase().includes(needle) && !c.short.toLowerCase().includes(needle) ? c.schools.filter((s) => s.toLowerCase().includes(needle)) : c.schools }))
    .filter((c) => c.schools.length);
  return (
    <div className="page">
      <h1 className="page-title">Schools & conferences</h1>
      <p className="muted">Every NCAA conference has its own private board. Don’t see your school, or it’s in the wrong conference? Verify anyway — unrecognized school emails go to a moderator, who’ll get you sorted.</p>
      <input className="search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search schools" aria-label="Search schools" />
      {[1, 2, 3].map((d) => {
        const list = shown.filter((c) => c.division === d);
        if (!list.length) return null;
        return (
          <section key={d}>
            <h2 className="section-title">{DIVISION_NAMES[d]}</h2>
            {list.map((c) => (
              <div key={c.id} className="card conf-card">
                <div className="conf-card-head">
                  <Link to={`/b/conf-${c.slug}`}><strong>{c.short}</strong></Link>
                  <span className="muted small">{c.name} · {c.school_count} schools</span>
                </div>
                <p className="small">{c.schools.join(' · ')}</p>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
