import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../session.jsx';
import Composer from '../components/Composer.jsx';
import { useTitle } from '../useTitle.js';

export default function NewPost() {
  const { user } = useSession();
  const [params] = useSearchParams();
  useTitle('New post');
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="page">
      <h1 className="page-title">New post</h1>
      <Composer defaultBoard={params.get('board') || undefined} />
      <p className="muted small">Posts are anonymous: no names, no profiles. In comments you’ll get a random animal icon that’s only consistent within one thread. Keep it about running and follow the <Link to="/rules">rules</Link> — no names of private individuals, no harassment, no doxxing.</p>
    </div>
  );
}
