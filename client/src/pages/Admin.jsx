import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { del, get, patch, post, put } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import Spinner from '../components/Spinner.jsx';
import PostCard from '../components/PostCard.jsx';
import { DIVISION_NAMES, timeAgo } from '../util.js';
import { useTitle } from '../useTitle.js';

function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => { get(path).then(setData).catch(setError); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Overview() {
  const { data } = useLoad('/admin/stats');
  if (!data) return <Spinner />;
  const tiles = [
    ['Accounts', data.users], ['Verified athletes', data.verified], ['Active today', data.activeToday],
    ['Posts today', data.postsToday], ['Comments today', data.commentsToday],
    ['Open reports', data.openReports], ['Pending verifications', data.pendingVerifications],
  ];
  return (
    <div className="stack">
      <div className="stat-grid">
        {tiles.map(([label, n]) => <div key={label} className="card stat"><div className="stat-n">{n}</div><div className="muted small">{label}</div></div>)}
      </div>
      <div className="card">
        <h3>Verified by division</h3>
        {[1, 2, 3].map((d) => <p key={d}>{DIVISION_NAMES[d]}: <strong>{data.byDivision.find((x) => x.division === d)?.n || 0}</strong></p>)}
      </div>
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState('open');
  const { data, reload } = useLoad(`/admin/reports?status=${status}`);
  const toast = useToast();
  const act = async (r, action) => {
    let reason;
    if (action === 'remove') {
      reason = prompt('Removal reason (shown to author):', r.reasons[0]?.label || 'Breaks the rules');
      if (reason === null) return;
    }
    try {
      await post('/admin/reports/resolve', { kind: r.kind, id: r.targetId, action, reason });
      toast(action === 'remove' ? 'Removed' : 'Dismissed — content restored');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="stack">
      <div className="segmented">
        {['open', 'actioned', 'dismissed'].map((s) => <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s}</button>)}
      </div>
      {!data ? <Spinner /> : !data.reports.length ? <div className="card empty">Nothing to review. 🎉</div> : data.reports.map((r) => (
        <div key={`${r.kind}-${r.targetId}`} className="card report">
          <div className="report-head">
            <span className="tag">{r.kind}</span>
            <strong>{r.count} report{r.count === 1 ? '' : 's'}</strong>
            {r.reasons.map((x) => <span key={x.key} className="tag tag-removed">{x.label}{x.n > 1 ? ` ×${x.n}` : ''}</span>)}
            <span className="muted small">{timeAgo(r.lastAt)} ago</span>
          </div>
          {r.details.length > 0 && <ul className="small muted">{r.details.map((d, i) => <li key={i}>“{d}”</li>)}</ul>}
          {!r.target ? <p className="muted">Content no longer exists.</p> : r.kind === 'post' ? (
            <PostCard post={r.target} />
          ) : (
            <blockquote className="report-body">
              {r.target.body || <em>[deleted]</em>}
              {r.target.postId && <div className="small"><Link to={`/p/${r.target.postId}${r.kind === 'comment' ? `#c${r.target.id}` : ''}`}>View in context</Link></div>}
            </blockquote>
          )}
          {r.target && (
            <div className="row">
              {status === 'open' && <button className="btn btn-danger btn-sm" onClick={() => act(r, 'remove')}>Remove</button>}
              {status === 'open' && <button className="btn btn-ghost btn-sm" onClick={() => act(r, 'dismiss')}>Dismiss</button>}
              {r.target.authorId || r.target.mod?.authorId ? <Link className="btn btn-ghost btn-sm" to={`/admin?tab=users&id=${r.target.authorId || r.target.mod.authorId}`}>Author</Link> : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Verifications() {
  const { data, reload } = useLoad('/admin/verifications');
  const toast = useToast();
  const act = async (v, action, addDomain = false) => {
    let reason;
    if (action === 'reject') { reason = prompt('Reason (sent to the student):', 'That email domain doesn’t belong to the school you picked.'); if (reason === null) return; }
    try { await post(`/admin/verifications/${v.id}`, { action, addDomain, reason }); toast('Done'); reload(); } catch (err) { toast(err.message, 'error'); }
  };
  if (!data) return <Spinner />;
  if (!data.requests.length) return <div className="card empty">No pending school verifications.</div>;
  return (
    <div className="stack">
      <p className="muted small">These students proved they own an email at a domain we don’t recognize, and picked a school. Approve if the domain belongs to that school. “Approve + learn domain” auto-verifies future students from it.</p>
      {data.requests.map((v) => (
        <div key={v.id} className="card">
          <p><strong>@{v.domain}</strong> → {v.school} <span className="muted">({v.conference} · D{'I'.repeat(v.division)})</span></p>
          <p className="small muted">Known domains for {v.school}: {v.knownDomains || 'none'} · requested {timeAgo(v.createdAt)} ago</p>
          {v.note && <p className="small">Note: “{v.note}”</p>}
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => act(v, 'approve', true)}>Approve + learn domain</button>
            <button className="btn btn-ghost btn-sm" onClick={() => act(v, 'approve')}>Approve once</button>
            <button className="btn btn-ghost btn-sm danger" onClick={() => act(v, 'reject')}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const [params, setParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const id = params.get('id');
  const filter = params.get('filter') || '';
  const path = id ? `/admin/users?id=${id}` : `/admin/users?filter=${filter}`;
  const { data, reload } = useLoad(path);
  const [found, setFound] = useState(null);
  const [content, setContent] = useState(null);
  const { user: me } = useSession();
  const toast = useToast();
  const list = found || data?.users;

  const ban = async (u) => {
    const days = prompt('Suspend for how many days?', '7');
    if (!days) return;
    const reason = prompt('Reason (shown to the user):', 'Breaking the community rules');
    if (reason === null) return;
    const purge = confirm('Also remove all of their posts and comments?');
    try { await post(`/admin/users/${u.id}/ban`, { days: Number(days), reason, purge }); toast('Suspended'); reload(); setFound(null); } catch (err) { toast(err.message, 'error'); }
  };
  const run = async (fn, msg) => { try { await fn(); toast(msg); reload(); setFound(null); } catch (err) { toast(err.message, 'error'); } };

  return (
    <div className="stack">
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const r = await get(`/admin/users?email=${encodeURIComponent(email)}`); setFound(r.users); if (!r.users.length) toast('No account with that exact email'); }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Look up by exact email" />
        <button className="btn btn-ghost btn-sm">Find</button>
      </form>
      <div className="segmented">
        {[['', 'Recent'], ['banned', 'Suspended'], ['staff', 'Staff']].map(([k, l]) => (
          <button key={k} className={!id && filter === k ? 'on' : ''} onClick={() => { setFound(null); setParams({ tab: 'users', filter: k }); }}>{l}</button>
        ))}
      </div>
      <p className="muted small">Emails are hashed, so accounts can only be found by exact email or from their content. Staff never see schools — only division and conference.</p>
      {!list ? <Spinner /> : list.map((u) => (
        <div key={u.id} className="card user-card">
          <div className="row-gap">
            <strong>User #{u.id}</strong>
            <span className="tag">{u.role}</span>
            {u.college && <span className="tag">{u.college.conference} · D{'I'.repeat(u.college.division)}{u.college.active ? '' : ' (expired)'}</span>}
            {u.bannedUntil && <span className="tag tag-removed">suspended until {new Date(u.bannedUntil).toLocaleDateString()}</span>}
          </div>
          <p className="small muted">Joined {new Date(u.createdAt).toLocaleDateString()} · last active {u.lastActiveAt ? `${timeAgo(u.lastActiveAt)} ago` : 'never'} · {u.posts} posts · {u.comments} comments · {u.removed} removed · {u.reportsAgainst} reports against</p>
          {u.banReason && u.bannedUntil && <p className="small">Reason: {u.banReason}</p>}
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={async () => setContent({ id: u.id, ...(await get(`/admin/users/${u.id}/content`)) })}>View content</button>
            {u.bannedUntil
              ? <button className="btn btn-ghost btn-sm" onClick={() => run(() => post(`/admin/users/${u.id}/unban`), 'Unsuspended')}>Unsuspend</button>
              : u.role !== 'admin' && <button className="btn btn-danger btn-sm" onClick={() => ban(u)}>Suspend</button>}
            {u.college && <button className="btn btn-ghost btn-sm" onClick={() => confirm('Revoke this college verification?') && run(() => post(`/admin/users/${u.id}/revoke-college`, { reason: 'manual' }), 'Revoked')}>Revoke college</button>}
            {me.role === 'admin' && u.id && (
              <select value={u.role} onChange={(e) => run(() => post(`/admin/users/${u.id}/role`, { role: e.target.value }), 'Role updated')} aria-label="Role">
                <option value="user">user</option><option value="mod">mod</option><option value="admin">admin</option>
              </select>
            )}
          </div>
          {content?.id === u.id && (
            <div className="stack">
              {content.posts.map((p) => <PostCard key={p.id} post={p} />)}
              {content.comments.map((c) => (
                <Link key={c.id} to={`/p/${c.postId}#c${c.id}`} className="card my-comment">
                  {c.body || <em>[deleted]</em>} <span className="muted small">· {c.score} pts {c.removed && '· removed'}</span>
                </Link>
              ))}
              {!content.posts.length && !content.comments.length && <p className="muted">No content.</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Removed() {
  const { data } = useLoad('/admin/removed');
  if (!data) return <Spinner />;
  if (!data.posts.length) return <div className="card empty">No removed posts.</div>;
  return <div className="feed">{data.posts.map((p) => <PostCard key={p.id} post={p} />)}</div>;
}

function BoardsAdmin() {
  const { data, reload } = useLoad('/admin/boards');
  const { refresh } = useSession();
  const toast = useToast();
  const [form, setForm] = useState({ slug: '', name: '', emoji: '💬', description: '' });
  const save = async (b, patchBody) => { try { await patch(`/admin/boards/${b.id}`, patchBody); toast('Saved'); reload(); refresh(); } catch (err) { toast(err.message, 'error'); } };
  if (!data) return <Spinner />;
  const pub = data.boards.filter((b) => b.kind === 'public');
  return (
    <div className="stack">
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await post('/admin/boards', form); setForm({ slug: '', name: '', emoji: '💬', description: '' }); toast('Board created'); reload(); refresh(); } catch (err) { toast(err.message, 'error'); }
      }}>
        <h3>New public board</h3>
        <div className="row">
          <input style={{ width: 64 }} value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} aria-label="Emoji" />
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || '' })} placeholder="Name" required />
          <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} placeholder="slug" required pattern="[a-z0-9][a-z0-9-]{1,39}" />
        </div>
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" />
        <button className="btn btn-primary btn-sm">Create</button>
      </form>
      <h3>Public boards</h3>
      {pub.map((b) => <BoardEditor key={b.id} b={b} onSave={save} onDelete={async () => {
        if (!confirm(`Delete ${b.name}${b.post_count ? ` and its ${b.post_count} posts` : ''}? Archive instead to keep history.`)) return;
        try { await del(`/admin/boards/${b.id}`, { force: true }); toast('Deleted'); reload(); refresh(); } catch (err) { toast(err.message, 'error'); }
      }} />)}
      <h3>College boards</h3>
      <p className="muted small">College boards are created from conferences (Schools tab). You can rename, re-describe, or archive them here.</p>
      {data.boards.filter((b) => b.kind !== 'public').map((b) => <BoardEditor key={b.id} b={b} onSave={save} />)}
    </div>
  );
}

function BoardEditor({ b, onSave, onDelete }) {
  const [f, setF] = useState({ name: b.name, emoji: b.emoji, description: b.description, position: b.position });
  return (
    <form className={`card board-editor ${b.archived ? 'is-removed' : ''}`} onSubmit={(e) => { e.preventDefault(); onSave(b, f); }}>
      <div className="row">
        <input style={{ width: 56 }} value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} aria-label="Emoji" />
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
        <input style={{ width: 70 }} type="number" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} aria-label="Order" title="Sort order" />
        <span className="muted small">/{b.slug} · {b.post_count} posts</span>
      </div>
      <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Description" />
      <div className="row">
        <button className="btn btn-primary btn-sm">Save</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSave(b, { archived: !b.archived })}>{b.archived ? 'Unarchive' : 'Archive'}</button>
        {onDelete && <button type="button" className="btn btn-ghost btn-sm danger" onClick={onDelete}>Delete</button>}
      </div>
    </form>
  );
}

function SchoolsAdmin() {
  const confs = useLoad('/admin/conferences');
  const [q, setQ] = useState('');
  const [conf, setConf] = useState('');
  const { data, reload } = useLoad(`/admin/schools?q=${encodeURIComponent(q)}${conf ? `&conference=${conf}` : ''}`);
  const { refresh } = useSession();
  const toast = useToast();
  const [newSchool, setNewSchool] = useState({ name: '', conferenceId: '', domains: '' });
  const [newConf, setNewConf] = useState({ slug: '', name: '', short: '', division: 1 });
  if (!confs.data) return <Spinner />;
  const confOptions = confs.data.conferences.map((c) => <option key={c.id} value={c.id}>D{'I'.repeat(c.division)} · {c.short_name}</option>);
  const run = async (fn, msg) => { try { await fn(); toast(msg); reload(); confs.reload(); refresh(); } catch (err) { toast(err.message, 'error'); } };

  return (
    <div className="stack">
      <p className="muted small">Realignment? Move a school to its new conference and its verified students move with it immediately.</p>
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search schools" />
        <select value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Conference"><option value="">All conferences</option>{confOptions}</select>
      </div>
      {!data ? <Spinner /> : data.schools.map((s) => <SchoolEditor key={s.id} s={s} confOptions={confOptions} onSave={(body) => run(() => patch(`/admin/schools/${s.id}`, body), 'Saved')} />)}

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); run(() => post('/admin/schools', newSchool), 'School added').then(() => setNewSchool({ name: '', conferenceId: '', domains: '' })); }}>
        <h3>Add school</h3>
        <input value={newSchool.name} onChange={(e) => setNewSchool({ ...newSchool, name: e.target.value })} placeholder="School name" required />
        <select value={newSchool.conferenceId} onChange={(e) => setNewSchool({ ...newSchool, conferenceId: e.target.value })} required aria-label="Conference"><option value="">Conference…</option>{confOptions}</select>
        <input value={newSchool.domains} onChange={(e) => setNewSchool({ ...newSchool, domains: e.target.value })} placeholder="Email domains, space separated (e.g. school.edu mail.school.edu)" />
        <button className="btn btn-primary btn-sm">Add school</button>
      </form>

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); run(() => post('/admin/conferences', newConf), 'Conference and board created').then(() => setNewConf({ slug: '', name: '', short: '', division: 1 })); }}>
        <h3>Add conference</h3>
        <p className="muted small">Creates the conference and its private board.</p>
        <div className="row">
          <input value={newConf.short} onChange={(e) => setNewConf({ ...newConf, short: e.target.value })} placeholder="Short name (e.g. ASUN)" required />
          <input value={newConf.slug} onChange={(e) => setNewConf({ ...newConf, slug: e.target.value.toLowerCase() })} placeholder="slug" required />
          <select value={newConf.division} onChange={(e) => setNewConf({ ...newConf, division: Number(e.target.value) })} aria-label="Division">
            <option value={1}>D-I</option><option value={2}>D-II</option><option value={3}>D-III</option>
          </select>
        </div>
        <input value={newConf.name} onChange={(e) => setNewConf({ ...newConf, name: e.target.value })} placeholder="Full name" required />
        <button className="btn btn-primary btn-sm">Add conference</button>
      </form>
    </div>
  );
}

function SchoolEditor({ s, confOptions, onSave }) {
  const [f, setF] = useState({ name: s.name, conferenceId: s.conference_id, domains: s.domains.join(' '), active: !!s.active });
  return (
    <form className={`card school-editor ${f.active ? '' : 'is-removed'}`} onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <div className="row">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
        <select value={f.conferenceId} onChange={(e) => setF({ ...f, conferenceId: Number(e.target.value) })} aria-label="Conference">{confOptions}</select>
        <span className="muted small">{s.verified} verified</span>
      </div>
      <input value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} aria-label="Domains" placeholder="domains" />
      <div className="row">
        <label className="check small"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
        <button className="btn btn-primary btn-sm">Save</button>
      </div>
    </form>
  );
}

function SettingsAdmin() {
  const { data, reload } = useLoad('/admin/settings');
  const { refresh } = useSession();
  const toast = useToast();
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ ...data.settings, bannedWords: data.settings.bannedWords.join('\n') }); }, [data]);
  if (!f) return <Spinner />;
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      try { await put('/admin/settings', f); toast('Settings saved'); reload(); refresh(); } catch (err) { toast(err.message, 'error'); }
    }}>
      <label>Site announcement (blank to hide)<input value={f.announcement} onChange={(e) => setF({ ...f, announcement: e.target.value })} /></label>
      <label>Hide posts at or below score<input type="number" value={f.autoHideScore} onChange={(e) => setF({ ...f, autoHideScore: e.target.value })} /></label>
      <label>Reports needed to auto-hide<input type="number" min={1} value={f.reportThreshold} onChange={(e) => setF({ ...f, reportThreshold: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={f.censorExpletives} onChange={(e) => setF({ ...f, censorExpletives: e.target.checked })} /> Censor swear words (fuck → f*ck). Slurs are always blocked.</label>
      <label className="check"><input type="checkbox" checked={f.blockContactInfo} onChange={(e) => setF({ ...f, blockContactInfo: e.target.checked })} /> Block emails and phone numbers in posts</label>
      <label className="check"><input type="checkbox" checked={f.publicReadWithoutAccount} onChange={(e) => setF({ ...f, publicReadWithoutAccount: e.target.checked })} /> Let logged-out visitors read public boards</label>
      <label>Banned words or phrases (one per line)<textarea rows={6} value={f.bannedWords} onChange={(e) => setF({ ...f, bannedWords: e.target.value })} /></label>
      <button className="btn btn-primary">Save settings</button>
    </form>
  );
}

function Log() {
  const { data } = useLoad('/admin/log');
  if (!data) return <Spinner />;
  return (
    <div className="card list">
      {data.log.map((l) => (
        <div key={l.id} className="log-row small">
          <span className="muted">{timeAgo(l.createdAt)}</span> <strong>#{l.modId}</strong> {l.action} {l.targetKind && `${l.targetKind} #${l.targetId}`} {l.details && <span className="muted">— {l.details}</span>}
        </div>
      ))}
      {!data.log.length && <p className="muted">No actions yet.</p>}
    </div>
  );
}

const TABS = [
  ['overview', 'Overview', Overview, false],
  ['reports', 'Reports', Reports, false],
  ['verifications', 'Schools queue', Verifications, false],
  ['users', 'Users', Users, false],
  ['removed', 'Removed', Removed, false],
  ['boards', 'Boards', BoardsAdmin, true],
  ['schools', 'Schools', SchoolsAdmin, true],
  ['settings', 'Settings', SettingsAdmin, true],
  ['log', 'Mod log', Log, false],
];

export default function Admin() {
  const { user, loading } = useSession();
  const [params, setParams] = useSearchParams();
  useTitle('Moderation');
  if (loading) return <div className="page"><Spinner /></div>;
  if (!user || (user.role !== 'admin' && user.role !== 'mod')) return <Navigate to="/" replace />;
  const tabs = TABS.filter(([, , , adminOnly]) => !adminOnly || user.role === 'admin');
  const tab = params.get('tab') || (params.get('id') ? 'users' : 'overview');
  const Active = (tabs.find(([k]) => k === tab) || tabs[0])[2];
  return (
    <div className="page page-wide">
      <h1 className="page-title">Moderation</h1>
      <div className="tabs tabs-scroll">
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setParams({ tab: k })}>{label}</button>)}
      </div>
      <Active />
    </div>
  );
}
