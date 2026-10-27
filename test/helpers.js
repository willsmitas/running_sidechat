import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backstretch-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dir;
process.env.ADMIN_EMAILS = 'admin@example.com';

const { openDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { sentMail } = await import('../server/lib/mailer.js');
const { resetLimits } = await import('../server/lib/ratelimit.js');

export { sentMail, resetLimits };

export async function startServer() {
  const db = openDb(':memory:');
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, close: () => new Promise((r) => server.close(r)) };
}

export function client(base) {
  let cookie = '';
  async function req(method, url, body, { raw = false, headers = {} } = {}) {
    const opts = { method, headers: { 'x-requested-with': 'backstretch', ...headers } };
    if (cookie) opts.headers.cookie = cookie;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(base + url, opts);
    const set = res.headers.getSetCookie();
    for (const c of set) {
      const [pair] = c.split(';');
      cookie = pair.endsWith('=') ? '' : pair;
    }
    if (raw) return res;
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }
  return {
    get: (u, o) => req('GET', u, undefined, o),
    post: (u, b, o) => req('POST', u, b ?? {}, o),
    put: (u, b) => req('PUT', u, b ?? {}),
    patch: (u, b) => req('PATCH', u, b ?? {}),
    del: (u, b) => req('DELETE', u, b),
    get cookie() { return cookie; },
  };
}

// Creates an account through the real signup flow and returns a logged-in client.
export async function signup(base, email, password = 'correct horse battery') {
  const c = client(base);
  const s = await c.post('/api/auth/signup', { email, password, acceptRules: true });
  if (s.status !== 200) throw new Error(`signup failed: ${JSON.stringify(s.data)}`);
  const v = await c.post('/api/auth/verify', { email, code: s.data.devCode });
  if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.data)}`);
  c.verify = v.data;
  return c;
}
