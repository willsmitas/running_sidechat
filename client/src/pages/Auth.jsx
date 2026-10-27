import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../api.js';
import { useSession } from '../session.jsx';
import { useToast } from '../toast.jsx';
import { useTitle } from '../useTitle.js';

export function DevCode({ code }) {
  if (!code) return null;
  return <p className="callout small">Dev mode (no email provider configured): your code is <strong>{code}</strong></p>;
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function Login() {
  const { refresh } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  useTitle('Log in');
  return (
    <div className="page narrow">
      <form className="card auth" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/login', { email, password }); await refresh(); nav(loc.state?.from || '/', { replace: true }); }); }}>
        <h1>Log in</h1>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        <p className="muted small center"><Link to="/forgot">Forgot password?</Link> · <Link to="/signup">Create an account</Link></p>
      </form>
    </div>
  );
}

export function Signup() {
  const { refresh } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const { busy, error, run } = useSubmit();
  useTitle('Sign up');
  const isEdu = /\.edu$/i.test(email.split('@')[1] || '');

  if (step === 'code') {
    return (
      <div className="page narrow">
        <form className="card auth" onSubmit={(e) => { e.preventDefault(); run(async () => {
          const r = await post('/auth/verify', { email, code });
          await refresh();
          if (r.collegeVerified) { toast('Welcome! Your college boards are unlocked.'); nav('/college'); }
          else if (r.collegeChoices) nav('/verify-college', { state: { email } });
          else nav('/');
        }); }}>
          <h1>Check your email</h1>
          <p className="muted">We sent a 6-digit code to <strong>{email}</strong>. It expires in 15 minutes.</p>
          <DevCode code={devCode} />
          <label>Code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus required className="code-input" /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
          <p className="muted small center">
            <button type="button" className="link-btn" onClick={() => run(async () => { const r = await post('/auth/resend', { email }); setDevCode(r.devCode || null); toast('Code re-sent'); })}>Resend code</button>
            {' · '}
            <button type="button" className="link-btn" onClick={() => setStep('form')}>Use a different email</button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <form className="card auth" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post('/auth/signup', { email, password, acceptRules: accept }); setDevCode(r.devCode || null); setStep('code'); }); }}>
        <h1>Join Backstretch</h1>
        <p className="muted">Anonymous by design. We never show your email, and we only store it as a one-way hash.</p>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {isEdu && <p className="callout small">🎓 Using your school email verifies you for your NCAA, division, and conference boards automatically.</p>}
        {!isEdu && email.includes('@') && <p className="muted small">College athlete? Use your <strong>.edu</strong> email to unlock college boards — or add it later.</p>}
        <label>Password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label className="check"><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> I’m 13 or older and agree to the <Link to="/rules" target="_blank">community rules</Link>.</label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !accept}>{busy ? 'Sending code…' : 'Continue'}</button>
        <p className="muted small center">Already have an account? <Link to="/login">Log in</Link></p>
      </form>
    </div>
  );
}

export function Forgot() {
  const { refresh } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState(null);
  const { busy, error, run } = useSubmit();
  useTitle('Reset password');
  return (
    <div className="page narrow">
      {step === 'email' ? (
        <form className="card auth" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post('/auth/forgot', { email }); setDevCode(r.devCode || null); setStep('code'); }); }}>
          <h1>Reset password</h1>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>Send reset code</button>
        </form>
      ) : (
        <form className="card auth" onSubmit={(e) => { e.preventDefault(); run(async () => { await post('/auth/reset', { email, code, password }); await refresh(); toast('Password updated'); nav('/'); }); }}>
          <h1>Enter your code</h1>
          <p className="muted">If an account exists for <strong>{email}</strong>, we sent it a code.</p>
          <DevCode code={devCode} />
          <label>Code<input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} required className="code-input" /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>Update password</button>
        </form>
      )}
    </div>
  );
}
