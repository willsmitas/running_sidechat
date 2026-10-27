// Fills a development database with demo accounts and conversations.
// Usage: npm run seed   (refuses to run with NODE_ENV=production)
import config from '../server/config.js';
import { openDb, tx } from '../server/db.js';
import { hashEmail, hashPassword } from '../server/lib/crypto.js';
import { ensureAlias } from '../server/lib/threads.js';

if (config.isProd && !process.argv.includes('--force')) {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const db = openDb(config.dbFile);
const PASSWORD = 'password123';
const pw = hashPassword(PASSWORD);
const now = Date.now();
const H = 3600_000;

function user(email, schoolName) {
  let u = db.prepare('SELECT id FROM users WHERE email_hash = ?').get(hashEmail(email));
  if (!u) {
    const role = email.startsWith('admin@') ? 'admin' : 'user';
    u = { id: Number(db.prepare('INSERT INTO users (email_hash, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(hashEmail(email), pw, role, now - 30 * 86400_000).lastInsertRowid) };
  }
  if (schoolName) {
    const s = db.prepare('SELECT id FROM schools WHERE name = ?').get(schoolName);
    db.prepare(`INSERT OR REPLACE INTO college_verifications (user_id, school_id, email_hash, verified_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .run(u.id, s.id, hashEmail(`college-${email}`), now, now + 365 * 86400_000);
  }
  return u.id;
}

const board = (slug) => db.prepare('SELECT id FROM boards WHERE slug = ?').get(slug).id;

function vote(uid, kind, id, value) {
  const table = kind === 'post' ? 'posts' : 'comments';
  const r = db.prepare('INSERT OR IGNORE INTO votes (user_id, kind, target_id, value, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, kind, id, value, now);
  if (r.changes) db.prepare(`UPDATE ${table} SET upvotes = upvotes + ?, downvotes = downvotes + ?, score = score + ? WHERE id = ?`).run(value > 0 ? 1 : 0, value < 0 ? 1 : 0, value, id);
}

function makePost(uid, slug, body, hoursAgo, { poll, flair, voters = [] } = {}) {
  const t = now - hoursAgo * H;
  const id = Number(db.prepare('INSERT INTO posts (board_id, user_id, body, flair, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)').run(board(slug), uid, body, flair || null, t, t).lastInsertRowid);
  db.prepare('INSERT INTO post_aliases (post_id, user_id, idx) VALUES (?, ?, 0)').run(id, uid);
  db.prepare('INSERT INTO follows (user_id, post_id) VALUES (?, ?)').run(uid, id);
  vote(uid, 'post', id, 1);
  poll?.forEach((text, i) => db.prepare('INSERT INTO poll_options (post_id, idx, text) VALUES (?, ?, ?)').run(id, i, text));
  voters.forEach(([v, val]) => vote(v, 'post', id, val));
  return id;
}

function comment(uid, postId, body, minutesAfter, parentId = null) {
  const p = db.prepare('SELECT created_at FROM posts WHERE id = ?').get(postId);
  const t = Math.min(now, p.created_at + minutesAfter * 60_000);
  const idx = ensureAlias(db, postId, uid);
  const id = Number(db.prepare('INSERT INTO comments (post_id, parent_id, user_id, alias_idx, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(postId, parentId, uid, idx, body, t).lastInsertRowid);
  vote(uid, 'comment', id, 1);
  db.prepare('UPDATE posts SET comment_count = comment_count + 1, last_activity_at = MAX(last_activity_at, ?) WHERE id = ?').run(t, postId);
  return id;
}

if (db.prepare('SELECT COUNT(*) AS n FROM posts').get().n > 0 && !process.argv.includes('--again')) {
  console.log('Database already has posts; skipping demo seed (pass --again to add more).');
  process.exit(0);
}

tx(db, () => {
  const admin = user('admin@example.com');
  const ore = user('duck@uoregon.edu', 'Oregon');
  const nau = user('lumberjack@nau.edu', 'Northern Arizona');
  const stan = user('cardinal@stanford.edu', 'Stanford');
  const wisc = user('badger@wisc.edu', 'Wisconsin');
  const gvsu = user('laker@gvsu.edu', 'Grand Valley State');
  const wash = user('bear@wustl.edu', 'WashU');
  const nCent = user('cardinal@northcentralcollege.edu', 'North Central (IL)');
  const fans = [user('fan1@example.com'), user('fan2@example.com'), user('fan3@example.com'), user('fan4@example.com')];
  const all = [ore, nau, stan, wisc, gvsu, wash, nCent, ...fans];
  const ups = (n, val = 1) => all.slice(0, n).map((u) => [u, val]);

  const p1 = makePost(fans[0], 'general', 'Unpopular opinion: the mile should be run at every college championship instead of the 1500. It’s more fun to watch and the times actually mean something to normal people.', 5, { voters: ups(9) });
  comment(fans[1], p1, 'Hard agree. Nobody outside the sport knows what a good 1500 is.', 12);
  const c = comment(nau, p1, 'The 1500 is the Olympic event though. Collegians need to train for what they’ll race as pros.', 30);
  comment(fans[0], p1, 'Pros race the mile on the circuit all the time now. Weak argument.', 41, c);
  comment(stan, p1, 'Indoors we already get the mile. Outdoors keep it metric.', 66);

  makePost(fans[2], 'pro', 'Who wins the 5000 at the next global championship? Feels wide open with how the Diamond League season shook out.', 9, { poll: ['A Kenyan', 'An Ethiopian', 'A Norwegian', 'An American', 'Someone else'], voters: ups(7) });
  const p3 = makePost(fans[3], 'training', 'Coming back from a tibial stress reaction. 8 weeks off, cleared to run. How fast do people usually rebuild mileage? I was at 70/week.', 20, { voters: ups(6) });
  comment(gvsu, p3, 'Get your bone density and RED-S stuff checked if you haven’t. Then go slow — 10% a week is too fast coming off a bone injury in my experience.', 50);
  comment(fans[1], p3, 'Run/walk for the first two weeks, every other day. Boring but it works.', 90);
  makePost(fans[1], 'gear', 'Are super shoes making 5k/10k times on the track meaningless or is that cope from people who ran in the 2010s?', 30, { voters: ups(4).concat([[fans[3], -1]]) });
  makePost(fans[0], 'high-school', 'Seniors who just committed: what actually mattered in your decision? Coach, team culture, academics, scholarship money?', 44, { voters: ups(5) });

  const n1 = makePost(ore, 'ncaa', 'Pre-nationals takeaways? Our top 5 spread was way too big. Everyone else see the course get chewed up by the last race?', 3, { flair: 'DI · Big Ten', voters: ups(6) });
  comment(nau, n1, 'Course was rough by the end, yeah. Spikes > flats no question.', 20);
  comment(wash, n1, 'D3 side: the course was fine for us in the morning lol', 45);
  makePost(gvsu, 'ncaa', 'Real question for everyone: how many miles a week is your team at in-season? Curious how much it varies by division.', 15, { poll: ['Under 50', '50–70', '70–90', '90+'], voters: ups(6) });
  const d1 = makePost(stan, 'd1', 'Anyone else’s team doing altitude camps over winter break this year? Trying to figure out if it’s worth paying out of pocket.', 26, { voters: ups(4) });
  comment(nau, d1, 'Flagstaff is cheap in winter if you can deal with the snow. DM me if you want spots.', 60);
  makePost(ore, 'conf-big-ten', 'B1G XC predictions? I have it Wisconsin, then a dogfight for 2nd.', 7, { voters: [[wisc, 1]] });
  makePost(wisc, 'conf-big-ten', 'Shoutout to whoever was running intervals at 6am in the snow on the lakeshore path yesterday. Respect.', 31, { voters: [[ore, 1]] });
  makePost(gvsu, 'd2', 'D2 regionals are going to be stacked this year. Who are people sleeping on?', 18, { voters: [] });
  makePost(wash, 'd3', 'D3 nationals course preview thread — anyone raced there before?', 12, { voters: [[nCent, 1]] });
  makePost(nCent, 'conf-cciw', 'CCIW meet hosting rotation is weird this year. Anyone know where it is?', 40, { voters: [] });
  makePost(admin, 'general', 'Welcome to Backstretch! Read the rules, keep it about running, and be decent. College athletes: verify your .edu to unlock your division and conference boards.', 72, { voters: ups(10) });
  db.prepare('UPDATE posts SET pinned = 1 WHERE user_id = ? AND body LIKE ?').run(admin, 'Welcome to Backstretch%');
});

console.log(`Seeded demo data. Log in with any of these (password: ${PASSWORD}):
  admin@example.com (admin)
  duck@uoregon.edu (D1, Big Ten)    lumberjack@nau.edu (D1, Big Sky)
  laker@gvsu.edu (D2, GLIAC)        bear@wustl.edu (D3, UAA)
  fan1@example.com (no college)`);
