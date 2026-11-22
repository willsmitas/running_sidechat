import { useState } from 'react';
import { post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { compact } from '../util.js';

export default function Vote({ kind, id, score, upvotes = 0, downvotes = 0, myVote, horizontal = false, disabled = false }) {
  const [state, setState] = useState({ score, upvotes, downvotes, myVote });
  const [showTip, setShowTip] = useState(false);
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();

  async function cast(e, v) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return nav('/login');
    if (disabled) return toast('Only members can vote here.');
    const value = state.myVote === v ? 0 : v;
    const prev = state;
    setState({
      score: state.score - state.myVote + value,
      upvotes: state.upvotes - (state.myVote === 1) + (value === 1),
      downvotes: state.downvotes - (state.myVote === -1) + (value === -1),
      myVote: value,
    });
    try {
      setState(await post(`/${kind === 'post' ? 'posts' : 'comments'}/${id}/vote`, { value }));
    } catch (err) {
      setState(prev);
      toast(err.message, 'error');
    }
  }

  const breakdown = `${state.upvotes.toLocaleString()} upvote${state.upvotes === 1 ? '' : 's'} · ${state.downvotes.toLocaleString()} downvote${state.downvotes === 1 ? '' : 's'}`;

  return (
    <div className={`vote ${horizontal ? 'vote-h' : ''}`}>
      <button type="button" className={`vote-btn ${state.myVote === 1 ? 'on-up' : ''}`} onClick={(e) => cast(e, 1)} aria-label="Upvote" aria-pressed={state.myVote === 1}>
        <Icon name="up" size={horizontal ? 16 : 20} />
      </button>
      {/* Hover (or tap, on touch screens) the score to see the vote breakdown. */}
      <button
        type="button"
        className={`vote-score ${state.myVote === 1 ? 'up' : state.myVote === -1 ? 'down' : ''}`}
        aria-label={`Score ${state.score}: ${breakdown}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTip(true); }}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        onBlur={() => setShowTip(false)}
      >
        {compact(state.score)}
        {showTip && (
          <span className="vote-tip" role="tooltip">
            <span className="vote-tip-up">▲ {state.upvotes.toLocaleString()}</span>
            <span className="vote-tip-down">▼ {state.downvotes.toLocaleString()}</span>
          </span>
        )}
      </button>
      <button type="button" className={`vote-btn ${state.myVote === -1 ? 'on-down' : ''}`} onClick={(e) => cast(e, -1)} aria-label="Downvote" aria-pressed={state.myVote === -1}>
        <Icon name="down" size={horizontal ? 16 : 20} />
      </button>
    </div>
  );
}
