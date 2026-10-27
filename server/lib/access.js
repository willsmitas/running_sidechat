import { getSettings } from './settings.js';

export const isStaff = (user) => !!user && (user.role === 'admin' || user.role === 'mod');
export const isBanned = (user) => !!user?.banned_until && user.banned_until > Date.now();

// Whether a user's verified college grants membership in a private board.
export function isMember(user, board) {
  if (board.kind === 'public') return true;
  const c = user?.college;
  if (!c || !c.active) return false;
  if (board.kind === 'ncaa') return true;
  if (board.kind === 'division') return c.division === board.division;
  if (board.kind === 'conference') return c.conferenceId === board.conference_id;
  return false;
}

export function boardAccess(db, user, board) {
  if (board.kind === 'public') {
    const canView = !!user || getSettings(db).publicReadWithoutAccount;
    return { canView, canPost: !!user && !isBanned(user) && !board.archived, member: true, reason: canView ? null : 'login' };
  }
  const member = isMember(user, board);
  let reason = null;
  if (!member) {
    if (!user) reason = 'login';
    else if (!user.college) reason = 'verify';
    else if (!user.college.active) reason = 'expired';
    else reason = 'other';
  }
  return {
    canView: member || isStaff(user),
    canPost: member && !isBanned(user) && !board.archived,
    member,
    reason,
  };
}

export function lockedMessage(reason, board) {
  switch (reason) {
    case 'login': return 'Log in to see this board.';
    case 'verify': return `${board.name} is for verified college runners. Verify your school email to get in.`;
    case 'expired': return 'Your college verification has expired. Re-verify your school email to get back in.';
    default: return `${board.name} is only open to verified members of ${board.kind === 'conference' ? 'this conference' : 'this division'}.`;
  }
}

export function visibleBoardIds(db, user) {
  const boards = db.prepare('SELECT * FROM boards').all();
  return boards.filter((b) => boardAccess(db, user, b).canView).map((b) => b.id);
}
