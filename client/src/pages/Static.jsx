import { Link } from 'react-router-dom';
import { useTitle } from '../useTitle.js';

export function Rules() {
  useTitle('Rules');
  return (
    <div className="page prose card">
      <h1>Community rules</h1>
      <p>Backstretch is anonymous so people can talk honestly about the sport. Anonymity is a privilege, not a shield. Break these and your posts come down; break them repeatedly and you’re out.</p>
      <ol>
        <li><strong>No harassment or bullying.</strong> Critique performances, programs, and decisions — not people’s bodies, appearance, or personal lives.</li>
        <li><strong>No doxxing.</strong> Don’t post anyone’s contact info, address, or private details, and don’t try to unmask anonymous users.</li>
        <li><strong>Leave private individuals out of it.</strong> High schoolers, walk-ons, and non-public figures are off-limits by name. Public figures and coaches can be discussed on their public conduct.</li>
        <li><strong>No defamation.</strong> Don’t present rumors about a real person as fact. Allegations of abuse or misconduct belong with a coach, compliance office, Title IX office, or SafeSport — not here.</li>
        <li><strong>No slurs, hate speech, threats, or sexual content.</strong> Posts containing slurs are blocked automatically. Swearing is fine, but it’s shown censored (f*ck).</li>
        <li><strong>Body talk is off-limits.</strong> Comments on athletes’ weight or bodies, and content that promotes disordered eating, are removed.</li>
        <li><strong>College boards stay in the room.</strong> Don’t screenshot private board posts to the public, and don’t use them to recruit, tamper, or game NCAA rules.</li>
        <li><strong>No spam or self-promo</strong> beyond the occasional relevant link.</li>
      </ol>
      <h2>How moderation works</h2>
      <p>Anything voted below −5 drops out of feeds. Three independent reports hide a post until a moderator reviews it. Moderators can remove content, lock threads, and suspend accounts. Removed posts tell their author why.</p>
      <h2>If you’re struggling</h2>
      <p>Call or text <strong>988</strong> (US) any time for the Suicide &amp; Crisis Lifeline. For eating disorder support, contact your team physician or the ANAD helpline at 1-888-375-7767.</p>
      <p><Link to="/about">How we protect your anonymity →</Link></p>
    </div>
  );
}

export function About() {
  useTitle('About & privacy');
  return (
    <div className="page prose card">
      <h1>About & privacy</h1>
      <p>Backstretch is a message board for competitive distance running, built like Sidechat: anonymous posts, upvotes and downvotes, and per-thread animal icons in comments so conversations stay readable without anyone having a username.</p>
      <h2>Boards</h2>
      <ul>
        <li><strong>Public boards</strong> are open to anyone with an account (and readable without one).</li>
        <li><strong>College boards</strong> require a verified school email. Every verified athlete gets the <strong>NCAA</strong> board, their <strong>division</strong> board (D-I, D-II, or D-III), and their <strong>conference</strong> board.</li>
      </ul>
      <h2>What we store</h2>
      <ul>
        <li>Your login email and school email are stored only as keyed one-way hashes. We can check “is this the same email?” but can’t read them back.</li>
        <li>We store which school you verified with, so we can give you the right conference board even if your school changes conferences. It’s never shown on posts or to moderators — they see only division and conference.</li>
        <li>Photos are re-encoded in your browser and stripped of metadata (GPS location, device info) again on our server.</li>
        <li>Deleting a post wipes its text and image. Deleting your account removes your login, votes, chats, and college link — and optionally everything you posted.</li>
        <li>No ads, no trackers, no third-party analytics.</li>
        <li>GIFs picked from the GIF search load from GIPHY, so GIPHY can see the IP address of whoever views them, like any embedded image. Photos you upload are hosted by us.</li>
      </ul>
      <h2>What anonymity doesn’t cover</h2>
      <p>Writing style and details you share can identify you. We keep the minimum data needed to run the site and to act on legal requests, but no website can promise perfect anonymity. Post accordingly.</p>
    </div>
  );
}

export function NotFound() {
  useTitle('Not found');
  return (
    <div className="page"><div className="card empty"><h2>DNF</h2><p>That page doesn’t exist.</p><Link to="/" className="btn btn-primary">Back to the start line</Link></div></div>
  );
}
