import { useEffect, useState } from 'react';
import { get } from '../api.js';
import Modal from './Modal.jsx';
import Spinner from './Spinner.jsx';

// GIPHY search. Shows trending GIFs until you type.
export default function GifPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      setError('');
      get(q.trim() ? `/gifs/search?q=${encodeURIComponent(q.trim())}` : '/gifs/trending')
        .then((r) => live && setGifs(r.gifs))
        .catch((err) => live && setError(err.message));
    }, q ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <Modal title="Add a GIF" onClose={onClose} wide>
      <div className="stack">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GIPHY" autoFocus aria-label="Search GIFs" />
        {error ? <p className="error">{error}</p> : !gifs ? <Spinner /> : !gifs.length ? <p className="muted center">No GIFs found.</p> : (
          <div className="gif-grid">
            {gifs.map((g) => (
              <button key={g.id} type="button" className="gif-cell" onClick={() => onPick(g)} aria-label={g.title || 'GIF'}>
                <img src={g.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        )}
        <p className="muted tiny center">Powered by GIPHY</p>
      </div>
    </Modal>
  );
}
