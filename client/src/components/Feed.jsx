import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api.js';
import PostCard from './PostCard.jsx';
import Spinner from './Spinner.jsx';

// Paginated list of posts from any endpoint that returns { posts, nextOffset }.
export default function Feed({ path, showBoard = true, empty, canParticipate = true, onError }) {
  const [posts, setPosts] = useState([]);
  const [next, setNext] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const sentinel = useRef(null);
  const reqId = useRef(0);

  const load = useCallback(async (offset, replace) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await get(`${path}${sep}offset=${offset}`);
      if (id !== reqId.current) return;
      setPosts((cur) => {
        const merged = replace ? r.posts : [...cur, ...r.posts];
        const seen = new Set();
        return merged.filter((p) => !seen.has(p.id) && seen.add(p.id));
      });
      setNext(r.nextOffset);
      setError(null);
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err);
      onError?.(err);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [path, onError]);

  useEffect(() => {
    setPosts([]);
    setNext(0);
    load(0, true);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null || loading) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && next) load(next, false);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading, load]);

  if (error && !posts.length) return <div className="card empty">{error.message}</div>;
  return (
    <div className="feed">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} showBoard={showBoard} canParticipate={canParticipate}
          onRemoved={(id) => setPosts((cur) => cur.filter((x) => x.id !== id))} />
      ))}
      {loading && <Spinner />}
      {!loading && !posts.length && (empty || <div className="card empty">Nothing here yet.</div>)}
      {next !== null && next > 0 && <div ref={sentinel} className="sentinel" />}
      {next === null && posts.length > 8 && <div className="feed-end muted">You’re all caught up 🏁</div>}
    </div>
  );
}
