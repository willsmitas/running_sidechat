import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { get, post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { DevCode } from './Auth.jsx';
import { DIVISION_NAMES } from '../util.js';
import { useTitle } from '../useTitle.js';

function SchoolSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => get(`/schools?q=${encodeURIComponent(q)}`).then((r) => setResults(r.schools)), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="stack">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for your school" autoFocus aria-label="School" />
      <div className="choice-list">
        {results.map((s) => (
          <button type="button" key={s.id} className="choice" onClick={() => onPick(s)}>
            <strong>{s.name}</strong> <span className="muted">{s.conference} · D{'I'.repeat(s.division)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function VerifyCollege() {
  const { user, refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(loc.state?.email || '');
  const [school, setSchool] = useState(null);
  const [choices, setChoices] = useState(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [manual, setManual] = useState(false);
  const [devCode, setDevCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useTitle('Verify college');
  if (!user) return <Navigate to="/signup" replace />;

  const start = async (schoolId) => {
    setBusy(true); setError('');
    try {
      const r = await post('/college/start', { email, schoolId });
      if (r.needsChoice) { setChoices(r.schools); setStep('choose'); }
      else if (r.needsManual) setStep('manual');
      else { setManual(r.manual); setDevCode(r.devCode || null); setStep('code'); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post('/college/confirm', { email, code, note });
      await refresh();
      if (r.pending) setStep('pending');
      else { toast(`Verified: ${r.college.conferenceShort} · ${DIVISION_NAMES[r.college.division]}`); nav('/college'); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const c = user.college;
  return (
    <div className="page narrow">
      <div className="card auth">
        <h1>{c?.active ? 'Update college' : c ? 'Re-verify your college' : 'Verify your college'}</h1>
        {c && (
          <p className={`callout ${c.active ? '' : 'callout-warn'}`}>
            {c.active ? 'Verified' : 'Expired'}: <strong>{c.schoolName}</strong> · {c.conferenceShort} · {DIVISION_NAMES[c.division]}.
            {c.active && ` Good through ${new Date(c.expiresAt).toLocaleDateString()}.`}
          </p>
        )}
        {user.pendingCollege && step === 'email' && <p className="callout">Your request for <strong>{user.pendingCollege}</strong> is waiting on a moderator. You’ll get a notification when it’s approved.</p>}

        {step === 'email' && (
          <form onSubmit={(e) => { e.preventDefault(); start(); }} className="stack">
            <p className="muted">Enter your school-issued email. We’ll send it a code to prove it’s yours, then unlock the <strong>NCAA</strong> board plus your <strong>division</strong> and <strong>conference</strong> boards.</p>
            <label>School email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu" required autoFocus /></label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>Send code</button>
            <ul className="fine-print muted small">
              <li>Your school email is stored only as a one-way hash, separate from your posts.</li>
              <li>Your school is never shown on posts. Optional flair shows only your division or conference.</li>
              <li>Verification lasts a year, then you re-verify — so boards stay current students.</li>
            </ul>
            <p className="small"><Link to="/conferences">See every supported school</Link></p>
          </form>
        )}

        {step === 'choose' && (
          <div className="stack">
            <p>That email domain is shared by more than one school. Which one are you at?</p>
            <div className="choice-list">
              {choices.map((s) => (
                <button type="button" key={s.id} className="choice" disabled={busy} onClick={() => { setSchool(s); start(s.id); }}>
                  <strong>{s.name}</strong> <span className="muted">{s.conference} · D{'I'.repeat(s.division)}</span>
                </button>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            <button type="button" className="link-btn" onClick={() => setStep('email')}>← Different email</button>
          </div>
        )}

        {step === 'manual' && (
          <div className="stack">
            <p>We don’t recognize <strong>@{email.split('@')[1]}</strong> yet. Pick your school and we’ll still email you a code; after you confirm it, a moderator approves the new domain (usually within a day).</p>
            {school ? (
              <div className="stack">
                <p className="callout"><strong>{school.name}</strong> · {school.conference} · D{'I'.repeat(school.division)} <button type="button" className="link-btn" onClick={() => setSchool(null)}>change</button></p>
                <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => start(school.id)}>Send code</button>
              </div>
            ) : <SchoolSearch onPick={setSchool} />}
            {error && <p className="error">{error}</p>}
            <button type="button" className="link-btn" onClick={() => setStep('email')}>← Different email</button>
          </div>
        )}

        {step === 'code' && (
          <form onSubmit={confirm} className="stack">
            <p className="muted">We sent a code to <strong>{email}</strong>.</p>
            <DevCode code={devCode} />
            <label>Code<input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus className="code-input" /></label>
            {manual && <label>Note for moderators (optional)<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. grad students use this domain" /></label>}
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary btn-block" disabled={busy}>Verify</button>
            <button type="button" className="link-btn" onClick={() => start(school?.id)}>Resend code</button>
          </form>
        )}

        {step === 'pending' && (
          <div className="stack">
            <p className="callout">✅ Email confirmed. A moderator will approve your school shortly — you’ll get a notification when your boards unlock.</p>
            <Link to="/" className="btn btn-primary btn-block">Back home</Link>
          </div>
        )}

      </div>
    </div>
  );
}
