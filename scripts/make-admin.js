// Usage: npm run make-admin -- someone@example.com [mod|admin|user]
import config from '../server/config.js';
import { openDb } from '../server/db.js';
import { hashEmail, normalizeEmail } from '../server/lib/crypto.js';

const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !['admin', 'mod', 'user'].includes(role)) {
  console.error('Usage: npm run make-admin -- <email> [admin|mod|user]');
  process.exit(1);
}
const db = openDb(config.dbFile);
const r = db.prepare('UPDATE users SET role = ? WHERE email_hash = ?').run(role, hashEmail(normalizeEmail(email)));
if (!r.changes) {
  console.error('No account with that email. Sign up first (or add it to ADMIN_EMAILS before signing up).');
  process.exit(1);
}
console.log(`${email} is now ${role}.`);
