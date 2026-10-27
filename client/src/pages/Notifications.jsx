import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { del, get, post } from '../api.js';
import { useSession } from '../session.jsx';
import Spinner from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';
import { timeAgo } from '../util.js';
import { useTitle } from '../useTitle.js';

const ICONS = { comment: 'comment', thread: 'comment', reply: 'comment', post_milestone: 'up', comment_milestone: 'up', removed: 'shield', college: 'school' };

export default function Notifications() {
  const { user, refreshMe } = useSession();
  const [items, setItems] = useState(null);
  useTitle('Notifications');

  useEffect(() => {
    if (!user) return;
    get('/notifications').then((r) => {
      setItems(r.notifications);
      if (r.notifications.some((n) => !n.read)) post('/notifications/read').then(refreshMe);
    });
  }, [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <Navigate to="/login" replace />;
  if (!items) return <div className="page"><Spinner /></div>;
  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Notifications</h1>
        {items.length > 0 && <button className="btn btn-ghost btn-sm" onClick={async () => { await del('/notifications'); setItems([]); }}>Clear all</button>}
      </div>
      {!items.length && <div className="card empty">No notifications yet. Replies to your posts and comments show up here.</div>}
      <div className="card list">
        {items.map((n) => {
          const to = n.postId ? `/p/${n.postId}${n.commentId ? `#c${n.commentId}` : ''}` : n.type === 'college' ? '/college' : null;
          const inner = (
            <>
              <span className={`notif-icon notif-${n.type}`}><Icon name={ICONS[n.type] || 'bell'} size={16} /></span>
              <span className="notif-text">{n.text}</span>
              <span className="muted small">{timeAgo(n.createdAt)}</span>
            </>
          );
          return to
            ? <Link key={n.id} to={to} className={`notif ${n.read ? '' : 'unread'}`}>{inner}</Link>
            : <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
