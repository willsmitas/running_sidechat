import { useState } from 'react';
import { post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { compact } from '../util.js';

export default function Vote({ kind, id, score, myVote, horizontal = false, disabled = false }) {
  const [state, setState] = useState({ score, myVote });
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
    setState({ score: state.score - state.myVote + value, myVote: value });
    try {
      const r = await post(`/${kind === 'post' ? 'posts' : 'comments'}/${id}/vote`, { value });
      setState(r);
    } catch (err) {
      setState(prev);
      toast(err.message, 'error');
    }
  }

  return (
    <div className={`vote ${horizontal ? 'vote-h' : ''}`}>
      <button type="button" className={`vote-btn ${state.myVote === 1 ? 'on-up' : ''}`} onClick={(e) => cast(e, 1)} aria-label="Upvote" aria-pressed={state.myVote === 1}>
        <Icon name="up" size={horizontal ? 16 : 20} />
      </button>
      <span className={`vote-score ${state.myVote === 1 ? 'up' : state.myVote === -1 ? 'down' : ''}`}>{compact(state.score)}</span>
      <button type="button" className={`vote-btn ${state.myVote === -1 ? 'on-down' : ''}`} onClick={(e) => cast(e, -1)} aria-label="Downvote" aria-pressed={state.myVote === -1}>
        <Icon name="down" size={horizontal ? 16 : 20} />
      </button>
    </div>
  );
}
