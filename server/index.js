import config from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const db = openDb(config.dbFile);
const app = createApp(db);

// Housekeeping: drop expired sessions and codes, and old read notifications.
function cleanup() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM email_codes WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?').run(now - 60 * 86400_000);
}
cleanup();
setInterval(cleanup, 3600_000).unref();

app.listen(config.port, () => {
  console.log(`${config.appName} listening on ${config.appUrl}`);
  if (config.exposeDevCodes) console.log('Dev mode: no SMTP_URL set, verification codes are logged and returned by the API.');
});
