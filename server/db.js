import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import d1 from './data/ncaa-d1.js';
import d2 from './data/ncaa-d2.js';
import d3 from './data/ncaa-d3.js';
import { publicBoards } from './data/public-boards.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','mod','admin')),
  created_at INTEGER NOT NULL,
  last_active_at INTEGER,
  banned_until INTEGER,
  ban_reason TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY,
  purpose TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  data TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_codes_lookup ON email_codes(purpose, email_hash);

CREATE TABLE IF NOT EXISTS conferences (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  division INTEGER NOT NULL CHECK (division IN (1,2,3))
);

CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  conference_id INTEGER NOT NULL REFERENCES conferences(id),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS schools_conf ON schools(conference_id);

CREATE TABLE IF NOT EXISTS school_domains (
  domain TEXT NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (domain, school_id)
);
CREATE INDEX IF NOT EXISTS school_domains_school ON school_domains(school_id);

CREATE TABLE IF NOT EXISTS college_verifications (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  email_hash TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  domain TEXT NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🏃',
  kind TEXT NOT NULL CHECK (kind IN ('public','ncaa','division','conference')),
  division INTEGER,
  conference_id INTEGER REFERENCES conferences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS board_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  starred INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, board_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  image TEXT,
  flair TEXT,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  removed_at INTEGER,
  removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removal_reason TEXT
);
CREATE INDEX IF NOT EXISTS posts_board_new ON posts(board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_new ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id);

CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(body, content='posts', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE OF body ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO posts_fts(rowid, body) VALUES (new.id, new.body);
END;

CREATE TABLE IF NOT EXISTS poll_options (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS poll_options_post ON poll_options(post_id);

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  alias_idx INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  removed_at INTEGER,
  removed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  removal_reason TEXT
);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id);

-- Per-thread anonymous identity. idx 0 is always the original poster.
CREATE TABLE IF NOT EXISTS post_aliases (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id),
  UNIQUE (post_id, idx)
);

CREATE TABLE IF NOT EXISTS votes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('post','comment')),
  target_id INTEGER NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, target_id)
);
CREATE INDEX IF NOT EXISTS votes_target ON votes(kind, target_id);

CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS hides (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);

-- Thread subscriptions drive reply notifications. muted=1 silences a thread.
CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  muted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post','comment','message')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (reporter_id, kind, target_id)
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  starter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  starter_alias INTEGER NOT NULL,
  recipient_alias INTEGER NOT NULL,
  context TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  starter_read_at INTEGER NOT NULL DEFAULT 0,
  recipient_read_at INTEGER NOT NULL DEFAULT 0,
  blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS conversations_starter ON conversations(starter_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_recipient ON conversations(recipient_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS mod_actions (
  id INTEGER PRIMARY KEY,
  mod_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_kind TEXT,
  target_id INTEGER,
  details TEXT,
  created_at INTEGER NOT NULL
);
`;

export const DEFAULT_SETTINGS = {
  // Posts/comments at or below this score drop out of feeds.
  autoHideScore: -6,
  // Distinct reports needed before content is hidden pending review.
  reportThreshold: 3,
  // Case-insensitive words/phrases that block a post or comment outright.
  bannedWords: [],
  // Block phone numbers and email addresses in posts (doxxing guard).
  blockContactInfo: true,
  // Let people read public boards without an account.
  publicReadWithoutAccount: true,
  // Pinned site-wide announcement shown above feeds ('' to hide).
  announcement: '',
};

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const DIVISION_BOARDS = [
  { division: 1, slug: 'd1', name: 'Division I', emoji: '🥇' },
  { division: 2, slug: 'd2', name: 'Division II', emoji: '🥈' },
  { division: 3, slug: 'd3', name: 'Division III', emoji: '🥉' },
];

// Seeds conferences, schools, domains and boards the first time the database
// is opened. Later edits made in the admin panel are never overwritten; new
// conferences added to the data files are picked up on the next boot.
function seed(db) {
  const now = Date.now();
  tx(db, () => {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, JSON.stringify(v));
    }

    const hasBoard = db.prepare('SELECT 1 FROM boards WHERE slug = ?');
    const insBoard = db.prepare(`INSERT INTO boards (slug, name, description, emoji, kind, division, conference_id, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const publicSeeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded_public_boards'").get();
    if (!publicSeeded) {
      publicBoards.forEach((b, i) => {
        if (!hasBoard.get(b.slug)) insBoard.run(b.slug, b.name, b.description, b.emoji, 'public', null, null, i, now);
      });
      db.prepare("INSERT INTO settings (key, value) VALUES ('seeded_public_boards', '1')").run();
    }

    if (!hasBoard.get('ncaa')) {
      insBoard.run('ncaa', 'NCAA', 'Every verified collegiate runner, all three divisions.', '🏛️', 'ncaa', null, null, 0, now);
    }
    for (const d of DIVISION_BOARDS) {
      if (!hasBoard.get(d.slug)) {
        insBoard.run(d.slug, d.name, `Verified runners at ${d.name} schools.`, d.emoji, 'division', d.division, null, d.division, now);
      }
    }

    const findConf = db.prepare('SELECT id FROM conferences WHERE slug = ?');
    const insConf = db.prepare('INSERT INTO conferences (slug, name, short_name, division) VALUES (?, ?, ?, ?)');
    const insSchool = db.prepare('INSERT INTO schools (name, conference_id) VALUES (?, ?)');
    const insDomain = db.prepare('INSERT OR IGNORE INTO school_domains (domain, school_id) VALUES (?, ?)');
    const divisions = [[1, d1], [2, d2], [3, d3]];
    for (const [division, conferences] of divisions) {
      conferences.forEach((c, i) => {
        if (findConf.get(c.slug)) return;
        const confId = Number(insConf.run(c.slug, c.name, c.short, division).lastInsertRowid);
        for (const [name, domains] of c.schools) {
          const schoolId = Number(insSchool.run(name, confId).lastInsertRowid);
          for (const d of domains.split(/\s+/).filter(Boolean)) insDomain.run(d.toLowerCase(), schoolId);
        }
        const slug = `conf-${c.slug}`;
        if (!hasBoard.get(slug)) {
          insBoard.run(slug, c.short, c.name, '🏟️', 'conference', division, confId, 100 * division + i, now);
        }
      });
    }
  });
}

// Statement that ignores named parameters the SQL doesn't use, so query
// builders can pass one params object regardless of which clauses applied.
export function prepareLoose(db, sql) {
  const stmt = db.prepare(sql);
  stmt.setAllowUnknownNamedParameters(true);
  return stmt;
}
