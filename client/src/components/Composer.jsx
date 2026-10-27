import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { prepareImage } from '../util.js';
import Icon from './Icon.jsx';

const MAX = 2000;

export default function Composer({ defaultBoard, onPosted, compact = false }) {
  const { user, boards } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const postable = useMemo(() => boards.filter((b) => b.canPost), [boards]);
  const [board, setBoard] = useState(defaultBoard && postable.some((b) => b.slug === defaultBoard) ? defaultBoard : postable[0]?.slug || '');
  const [body, setBody] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [poll, setPoll] = useState(null);
  const [flair, setFlair] = useState('none');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const target = boards.find((b) => b.slug === board);
  const college = user?.college?.active ? user.college : null;
  const flairOptions = [];
  if (college && target) {
    if (target.kind === 'public' || target.kind === 'ncaa') flairOptions.push(['division', `D${'I'.repeat(college.division)}`]);
    if (target.kind !== 'conference') flairOptions.push(['conference', `D${'I'.repeat(college.division)} · ${college.conferenceShort}`]);
  }

  async function pickImage(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const prepared = await prepareImage(f);
    if (prepared.size > 6 * 1024 * 1024) return toast('Images must be under 6 MB.', 'error');
    setImage(prepared);
    setPreview(URL.createObjectURL(prepared));
  }

  async function submit(e) {
    e.preventDefault();
    if (!body.trim()) return toast('Write something first.', 'error');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('board', board);
      fd.append('body', body);
      if (flair !== 'none' && flairOptions.some(([k]) => k === flair)) fd.append('flair', flair);
      if (poll) fd.append('poll', JSON.stringify(poll.filter((o) => o.trim())));
      if (image) fd.append('image', image);
      const r = await api('/posts', { method: 'POST', body: fd });
      setBody(''); setImage(null); setPreview(null); setPoll(null);
      toast('Posted');
      if (onPosted) onPosted(r.post);
      else nav(`/p/${r.post.id}`, { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!postable.length) return null;

  return (
    <form className={`card composer ${compact ? 'composer-compact' : ''}`} onSubmit={submit}>
      <div className="composer-row">
        <label className="sr-only" htmlFor="composer-board">Board</label>
        <select id="composer-board" value={board} onChange={(e) => setBoard(e.target.value)} className="board-select">
          <optgroup label="Public">
            {postable.filter((b) => b.kind === 'public').map((b) => <option key={b.slug} value={b.slug}>{b.emoji} {b.name}</option>)}
          </optgroup>
          {postable.some((b) => b.kind !== 'public') && (
            <optgroup label="College (verified only)">
              {postable.filter((b) => b.kind !== 'public').map((b) => <option key={b.slug} value={b.slug}>{b.emoji} {b.name}</option>)}
            </optgroup>
          )}
        </select>
        {target && target.kind !== 'public' && <span className="tag tag-private"><Icon name="lock" size={12} /> Private</span>}
      </div>
      <textarea
        className="composer-text"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX}
        rows={compact && !body ? 2 : 5}
        placeholder={target?.kind === 'public' ? 'What’s happening in the running world? You’re anonymous.' : `Say something to ${target?.name || 'the board'} — only verified members see this.`}
      />
      {preview && (
        <div className="composer-preview">
          <img src={preview} alt="Attachment preview" />
          <button type="button" className="icon-btn" onClick={() => { setImage(null); setPreview(null); }} aria-label="Remove image"><Icon name="close" /></button>
        </div>
      )}
      {poll && (
        <div className="composer-poll">
          {poll.map((o, i) => (
            <div key={i} className="poll-edit">
              <input value={o} maxLength={80} placeholder={`Option ${i + 1}`} onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value : x)))} />
              {poll.length > 2 && <button type="button" className="icon-btn" onClick={() => setPoll(poll.filter((_, j) => j !== i))} aria-label="Remove option"><Icon name="close" size={16} /></button>}
            </div>
          ))}
          {poll.length < 6 && <button type="button" className="link-btn" onClick={() => setPoll([...poll, ''])}>+ Add option</button>}
        </div>
      )}
      <div className="composer-tools">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        <button type="button" className="icon-btn" onClick={() => fileRef.current.click()} aria-label="Add image" title="Add image"><Icon name="image" /></button>
        <button type="button" className={`icon-btn ${poll ? 'on' : ''}`} onClick={() => setPoll(poll ? null : ['', ''])} aria-label="Add poll" title="Add poll"><Icon name="poll" /></button>
        {flairOptions.length > 0 && (
          <select value={flair} onChange={(e) => setFlair(e.target.value)} aria-label="Flair" className="flair-select" title="Optional flair shows you're verified without revealing your school">
            <option value="none">No flair</option>
            {flairOptions.map(([k, label]) => <option key={k} value={k}>✓ {label}</option>)}
          </select>
        )}
        <span className="spacer" />
        <span className={`counter ${body.length > MAX - 100 ? 'warn' : ''}`}>{MAX - body.length}</span>
        <button className="btn btn-primary" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </form>
  );
}
