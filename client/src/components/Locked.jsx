import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function Locked({ board, reason, message }) {
  const cta = {
    login: [['/signup', 'Sign up'], ['/login', 'Log in']],
    verify: [['/verify-college', 'Verify your school email']],
    expired: [['/verify-college', 'Re-verify']],
  }[reason] || [];
  return (
    <div className="card locked">
      <div className="locked-icon"><Icon name="lock" size={30} /></div>
      <h2>{board ? `${board.emoji} ${board.name}` : 'Private board'}</h2>
      <p>{message || 'This board is private.'}</p>
      <div className="row-center">
        {cta.map(([to, label], i) => <Link key={to} to={to} className={`btn ${i ? 'btn-ghost' : 'btn-primary'}`}>{label}</Link>)}
      </div>
      {reason === 'verify' && (
        <p className="muted small">Your school email is only used to confirm where you compete. It’s stored only as a one-way hash, and your school never appears on anything you post.</p>
      )}
    </div>
  );
}
