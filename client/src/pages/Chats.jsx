import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import Alias from '../components/Alias.jsx';
import Spinner from '../components/Spinner.jsx';
import Icon from '../components/Icon.jsx';
import Menu from '../components/Menu.jsx';
import ReportDialog from '../components/ReportDialog.jsx';
import { fullDate, timeAgo } from '../util.js';
import { useTitle } from '../useTitle.js';

export function ChatList() {
  const { user } = useSession();
  const [chats, setChats] = useState(null);
  useTitle('Chats');
  useEffect(() => { if (user) get('/chats').then((r) => setChats(r.chats)); }, [user]);
  if (!user) return <Navigate to="/login" replace />;
  if (!chats) return <div className="page"><Spinner /></div>;
  return (
    <div className="page">
      <h1 className="page-title">Chats</h1>
      <p className="muted small">Anonymous one-on-one chats. Start one from any post or comment — you both keep the icon you have in that thread.</p>
      {!chats.length && <div className="card empty">No chats yet.</div>}
      <div className="card list">
        {chats.map((c) => (
          <Link key={c.id} to={`/chats/${c.id}`} className={`chat-row ${c.unread ? 'unread' : ''}`}>
            <Alias alias={c.them} showName={false} />
            <div className="chat-row-main">
              <div className="chat-row-top"><strong>{c.them.name}</strong><span className="muted small">{timeAgo(c.lastMessageAt)}</span></div>
              <div className="muted small ellipsis">{c.context}</div>
              {c.lastMessage && <div className="ellipsis">{c.lastMessage.mine ? 'You: ' : ''}{c.lastMessage.body}</div>}
            </div>
            {c.unread && <span className="dot" aria-label="unread" />}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Chat() {
  const { id } = useParams();
  const { user, refreshMe } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [reporting, setReporting] = useState(null);
  const endRef = useRef(null);
  useTitle(data ? `Chat with ${data.chat.them.name}` : 'Chat');

  const load = useCallback(async () => {
    try {
      const r = await get(`/chats/${id}`);
      setData((prev) => {
        if (prev && prev.messages.length === r.messages.length) return { ...prev, chat: r.chat };
        return r;
      });
    } catch (err) { setError(err); }
  }, [id]);

  useEffect(() => { load().then(refreshMe); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length]);

  if (!user) return <Navigate to="/login" replace />;
  if (error) return <div className="page"><div className="card empty">{error.message}</div></div>;
  if (!data) return <div className="page"><Spinner /></div>;
  const { chat, messages } = data;

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    const text = body;
    setBody('');
    try {
      const r = await post(`/chats/${id}/messages`, { body: text });
      setData((d) => ({ ...d, messages: [...d.messages, r.message] }));
    } catch (err) {
      setBody(text);
      toast(err.message, 'error');
    }
  }

  async function block(on) {
    if (on && !confirm('Block this chat? Neither of you will be able to send messages.')) return;
    await post(`/chats/${id}/block`, { on });
    load();
  }

  return (
    <div className="page chat-page">
      <div className="chat-head card">
        <button type="button" className="icon-btn" onClick={() => nav('/chats')} aria-label="Back"><Icon name="back" /></button>
        <Alias alias={chat.them} />
        <span className="spacer" />
        {chat.postId && <Link to={`/p/${chat.postId}`} className="btn btn-ghost btn-sm">View post</Link>}
        <Menu items={[
          { label: chat.blockedByMe ? 'Unblock' : 'Block', icon: 'close', danger: !chat.blockedByMe, onClick: () => block(!chat.blockedByMe), hidden: chat.blocked && !chat.blockedByMe },
        ]} />
      </div>
      <div className="chat-context muted small">{chat.context}</div>
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
            <div className="bubble" title={fullDate(m.createdAt)}>{m.removed ? <em className="muted">Message removed</em> : m.body}</div>
            {!m.mine && !m.removed && <button type="button" className="link-btn tiny muted" onClick={() => setReporting(m.id)}>Report</button>}
          </div>
        ))}
        {!messages.length && <div className="empty muted">Say hi. You’re {chat.me.name} {chat.me.emoji} here.</div>}
        <div ref={endRef} />
      </div>
      {chat.blocked ? (
        <div className="callout">{chat.blockedByMe ? 'You blocked this chat.' : 'This chat is closed.'}</div>
      ) : chat.otherLeft ? (
        <div className="callout">The other person deleted their account.</div>
      ) : (
        <form className="chat-input" onSubmit={send}>
          <Alias alias={chat.me} showName={false} size="sm" />
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Message ${chat.them.name}`} maxLength={1000} autoFocus />
          <button className="btn btn-primary btn-sm" disabled={!body.trim()}>Send</button>
        </form>
      )}
      {reporting && <ReportDialog kind="message" id={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}
