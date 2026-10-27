import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Feed from '../components/Feed.jsx';
import { useTitle } from '../useTitle.js';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const [text, setText] = useState(q);
  useTitle(q ? `“${q}”` : 'Search');
  useEffect(() => setText(q), [q]);
  return (
    <div className="page">
      <h1 className="page-title">Search</h1>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) setParams({ q: text.trim() }); }}>
        <input className="search-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search posts on boards you can see" autoFocus aria-label="Search" />
      </form>
      {q && <Feed key={q} path={`/search?q=${encodeURIComponent(q)}`} empty={<div className="card empty">No posts match “{q}”.</div>} />}
    </div>
  );
}
