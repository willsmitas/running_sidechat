# Backstretch

Anonymous message boards for competitive distance running — LetsRun-style conversation, structured like Sidechat. Public boards are open to everyone; private boards are only for NCAA athletes who verify a school email.

## Features

**Boards**
- **Public boards** (starter set: General, Pro Running, Training, High School, Shoes & Gear — rename/add/archive them in Admin → Boards).
- **Private college boards**, unlocked by verifying a school email:
  - **NCAA** — every verified athlete
  - **Division I / II / III** — your division
  - **One board per conference** — 97 conferences (32 D-I, 23 D-II, 42 D-III) and ~1,000 schools are seeded in `server/data/ncaa-d*.js`
- Star boards, mute boards from your home feed, filter home by Everything / College / Starred.

**Sidechat-style posting**
- No usernames. Posts and comments are anonymous; inside a thread everyone gets a stable animal icon, and the original poster is marked **OP**. Icons differ from thread to thread.
- Upvotes/downvotes, Hot / New / Active / Top (day–all time) sorting, threaded replies, polls (results revealed after you vote), image uploads, saves, hides, search (SQLite FTS).
- Optional **flair** shows a verified poster’s division or conference (e.g. `✓ DI · Big Ten`) without revealing their school.
- Notifications for comments on your posts, replies to your comments, and upvote milestones (grouped, mutable per thread).
- **Anonymous chats**: message the OP or a commenter; both sides keep their thread identity. Block and report supported.
- Private karma and activity (your posts, comments, saved) visible only to you.

**College verification**
- Sign up with a `.edu` and you’re verified automatically; or add one later from **Verify college**.
- Emails are matched to schools by domain (subdomains included). Domains shared by several schools (e.g. `maine.edu`, `psu.edu`) ask the student to pick.
- Unknown academic domains: the student proves ownership by code, picks their school, and it goes to a moderator queue. Approving can “learn” the domain so the next student is instant.
- Verification expires after a year (configurable) so boards stay current students.
- Moving a school to a new conference (realignment) moves its students’ access immediately.

**Privacy**
- Login and school emails are stored only as keyed hashes (HMAC with a server secret) — never in plaintext.
- Moderators see an account’s division/conference, never its school.
- Images are re-encoded in the browser and stripped of EXIF/XMP/text metadata on the server (orientation preserved).
- Deleting a post wipes its text and image; deleting an account can also wipe everything posted.
- Posts containing email addresses or phone numbers are blocked (doxxing guard).

**Moderation** (`/admin`, for mods and admins)
- Report queue grouped by item, with reasons; 3 reports (configurable) auto-hide content pending review; heavily downvoted posts drop out of feeds.
- Remove/restore, pin/lock threads, suspend users (optionally purging their content), revoke college verification, mod log.
- Admins also manage boards, conferences, schools and domains, roles, banned words, the site announcement, and whether logged-out visitors can read public boards.

## Running it

Requires Node.js 22.15+ (uses the built-in `node:sqlite`; no native modules).

```bash
npm install
npm run seed      # optional: demo accounts + posts (password: password123)
npm run dev       # API on :3000 + Vite dev server on http://localhost:5173
```

Without `SMTP_URL`, verification codes are printed to the server log and shown in the UI (dev mode only).

Production:

```bash
cp .env.example .env   # set APP_URL, SMTP_URL, ADMIN_EMAILS, TRUST_PROXY
npm run build
npm start              # serves the API and built client on $PORT
```

Or `docker build -t backstretch . && docker run -p 3000:3000 -v backstretch:/data --env-file .env backstretch`.

Make someone an admin: put their email in `ADMIN_EMAILS` before they sign up, or run `npm run make-admin -- them@example.com [admin|mod]`.

**Back up `DATA_DIR`** (`backstretch.db` and `secret.key`). If `secret.key` is lost, nobody can log in, because every email hash depends on it.

## Tests

```bash
npm test
```

41 API tests covering auth, college verification and board access, posting/comments/aliases, votes, polls, notifications, search, reports, bans, admin tools, chats, and image metadata stripping.

## Layout

```
server/
  index.js, app.js, config.js, db.js   entry, Express app, config, schema + seeding
  data/ncaa-d1.js, -d2.js, -d3.js       conference → schools → email domains
  data/public-boards.js                 starter public boards
  routes/                               auth, college, boards/feed/search, posts, me, chats, reports, admin
  lib/                                  access rules, aliases, images, notifications, rate limits, sessions
client/src/                             React app (pages/, components/)
scripts/                                dev runner, demo seed, make-admin
test/                                   node:test API tests
```

## Notes and next steps

- Conference membership reflects the 2026–27 alignment as best known; D-II/D-III lists in particular should be reviewed. Everything is editable in Admin → Schools without a deploy, and unrecognized domains never lock anyone out (they fall back to the review queue).
- Public board categories are placeholders until you decide on them.
- Rate limits are in-memory, so run a single server process (or move them to Redis).
- Notifications and chats update by polling (30 s / 5 s); push notifications would need a service worker.
