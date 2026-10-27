import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';

export default function Poll({ postId, poll: initial, canVote }) {
  const [poll, setPoll] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { user } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const showResults = poll.total !== null;

  async function vote(e, optionId) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return nav('/login');
    if (!canVote) return toast('Only members can vote here.');
    setBusy(true);
    try {
      setPoll((await post(`/posts/${postId}/poll`, { optionId })).poll);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="poll" onClick={(e) => e.stopPropagation()}>
      {poll.options.map((o) => {
        const pct = showResults && poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
        const mine = poll.myVote === o.id;
        const canPick = !poll.myVote && !busy;
        if (!showResults) {
          return (
            <button key={o.id} type="button" className="poll-row" disabled={busy} onClick={(e) => vote(e, o.id)}>
              <span className="poll-text">{o.text}</span>
            </button>
          );
        }
        // The author sees live results but can still cast their own vote.
        const Row = canPick ? 'button' : 'div';
        return (
          <Row key={o.id} type={canPick ? 'button' : undefined} className={`poll-row result ${mine ? 'mine' : ''}`} onClick={canPick ? (e) => vote(e, o.id) : undefined}>
            <div className="poll-bar" style={{ width: `${pct}%` }} />
            <span className="poll-text">{o.text}{mine && ' ✓'}</span>
            <span className="poll-pct">{pct}%</span>
          </Row>
        );
      })}
      <div className="poll-meta muted">{showResults ? `${poll.total} vote${poll.total === 1 ? '' : 's'}` : 'Vote to see results'}</div>
    </div>
  );
}
