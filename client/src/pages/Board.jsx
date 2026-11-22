import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import Feed from '../components/Feed.jsx';
import SortBar from '../components/SortBar.jsx';
import Composer from '../components/Composer.jsx';
import Locked from '../components/Locked.jsx';
import Spinner from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';
import { useTitle } from '../useTitle.js';

// Board headers seen this session, shown instantly when you come back.
const boardCache = new Map();

const KIND_LABEL = { public: 'Public board', ncaa: 'Verified NCAA athletes', division: 'Verified division members', conference: 'Verified conference members' };

export default function Board() {
  const { slug } = useParams();
  const { user, setBoard } = useSession();
  const toast = useToast();
  const [board, setB] = useState(() => boardCache.get(slug) || null);
  const [error, setError] = useState(null);
  const [params, setParams] = useSearchParams();
  const [nonce, setNonce] = useState(0);
  const [showSchools, setShowSchools] = useState(false);
  const sort = params.get('sort') || 'hot';
  const t = params.get('t') || 'week';
  useTitle(board?.name);

  useEffect(() => {
    setB(boardCache.get(slug) || null);
    setError(null);
    get(`/boards/${slug}`).then((r) => { boardCache.set(slug, r.board); setB(r.board); }).catch(setError);
  }, [slug, user?.college?.active]);

  if (error) return <div className="page"><div className="card empty">{error.message}</div></div>;
  if (!board) return <div className="page"><Spinner /></div>;

  async function pref(key) {
    const val = !board[key];
    try {
      await post(`/boards/${slug}/prefs`, { [key]: val });
      setB({ ...board, [key]: val });
      boardCache.set(slug, { ...board, [key]: val });
      setBoard(slug, { [key]: val });
      toast(key === 'starred' ? (val ? 'Starred' : 'Unstarred') : val ? 'Muted from your home feed' : 'Unmuted');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="page">
      <div className="card board-head">
        <div className="board-emoji" aria-hidden>{board.emoji}</div>
        <div className="board-info">
          <h1>{board.name}</h1>
          <p className="muted">{board.description}</p>
          <div className="board-tags">
            <span className={`tag ${board.kind === 'public' ? '' : 'tag-private'}`}>
              {board.kind !== 'public' && <Icon name="lock" size={12} />} {KIND_LABEL[board.kind]}
            </span>
            {board.schools && (
              <button type="button" className="link-btn small" onClick={() => setShowSchools(!showSchools)}>
                {board.schools.length} schools {showSchools ? '▴' : '▾'}
              </button>
            )}
          </div>
          {showSchools && <p className="small muted school-list">{board.schools.join(' · ')}</p>}
        </div>
        {user && board.canView && (
          <div className="board-buttons">
            <button className={`icon-btn ${board.starred ? 'on-star' : ''}`} onClick={() => pref('starred')} aria-label={board.starred ? 'Unstar' : 'Star'} title="Star"><Icon name="star" /></button>
            <button className={`icon-btn ${board.muted ? 'on' : ''}`} onClick={() => pref('muted')} aria-label={board.muted ? 'Unmute' : 'Mute from home'} title="Hide from home feed"><Icon name="mute" /></button>
          </div>
        )}
      </div>
      {board.locked ? (
        <Locked board={board} reason={board.lockedReason} message={board.lockedMessage} />
      ) : (
        <>
          {board.canPost && <Composer compact defaultBoard={board.slug} onPosted={() => setNonce(nonce + 1)} key={`c-${board.slug}`} />}
          {!board.member && <div className="callout">You can see this board as staff, but only members can post or vote.</div>}
          <SortBar sort={sort} t={t} onChange={(v) => setParams(v)} />
          <Feed key={slug} version={nonce} path={`/feed?board=${slug}&sort=${sort}&t=${t}`} showBoard={false} canParticipate={board.member}
            empty={<div className="card empty">No posts yet. Start the conversation.</div>} />
        </>
      )}
    </div>
  );
}
