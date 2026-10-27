import config from '../config.js';
import { hashToken, randomToken } from './crypto.js';
import { forbidden, unauthorized } from './errors.js';
import { getCollege } from './college.js';
import { isBanned, isStaff } from './access.js';

export const COOKIE = 'bs_session';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(db, res, userId) {
  const token = randomToken();
  const now = Date.now();
  const expires = now + config.sessionDays * 86400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, now, expires);
  setCookie(res, token, expires);
  return token;
}

function setCookie(res, token, expires) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (config.isProd) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

export function loadUser(db) {
  const findSession = db.prepare('SELECT * FROM sessions WHERE token_hash = ?');
  const findUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const touch = db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?');
  return (req, _res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const s = findSession.get(hashToken(token));
      if (s && s.expires_at > Date.now()) {
        const u = findUser.get(s.user_id);
        if (u) {
          u.college = getCollege(db, u.id);
          req.user = u;
          if (!u.last_active_at || Date.now() - u.last_active_at > 5 * 60_000) touch.run(Date.now(), u.id);
        }
      }
    }
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireActive(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (isBanned(req.user)) {
    const until = new Date(req.user.banned_until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return next(forbidden(`Your account is suspended until ${until}${req.user.ban_reason ? `: ${req.user.ban_reason}` : '.'}`));
  }
  next();
}

export function requireStaff(req, _res, next) {
  if (!isStaff(req.user)) return next(forbidden());
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(forbidden());
  next();
}
