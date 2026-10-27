import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');

function loadDotEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv();

const env = process.env;
const dataDir = path.resolve(root, env.DATA_DIR || 'var');
fs.mkdirSync(dataDir, { recursive: true });

// The secret peppers every email hash and session token. It is generated on
// first boot and persisted so restarts keep accounts working. Losing it means
// nobody can log in again, so back it up alongside the database.
function loadSecret() {
  if (env.APP_SECRET) return env.APP_SECRET;
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

export default {
  root,
  isProd,
  isTest,
  port: Number(env.PORT || 3000),
  dataDir,
  dbFile: env.DB_FILE || path.join(dataDir, 'backstretch.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  secret: loadSecret(),
  appName: env.APP_NAME || 'Backstretch',
  appUrl: env.APP_URL || `http://localhost:${env.PORT || 3000}`,
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'Backstretch <no-reply@localhost>',
  // In development (no SMTP configured) verification codes are returned in API
  // responses so the app is usable without an email provider.
  exposeDevCodes: !isProd && !env.SMTP_URL,
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  collegeVerifyDays: Number(env.COLLEGE_VERIFY_DAYS || 365),
  sessionDays: Number(env.SESSION_DAYS || 60),
  trustProxy: env.TRUST_PROXY === '1',
};
