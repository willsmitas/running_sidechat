// Looks up the college a user has verified, and which schools an email
// address could belong to.

export function getCollege(db, userId) {
  const row = db.prepare(`
    SELECT cv.school_id, cv.verified_at, cv.expires_at, s.name AS school_name,
           c.id AS conference_id, c.slug AS conference_slug, c.name AS conference_name,
           c.short_name AS conference_short, c.division
    FROM college_verifications cv
    JOIN schools s ON s.id = cv.school_id
    JOIN conferences c ON c.id = s.conference_id
    WHERE cv.user_id = ?`).get(userId);
  if (!row) return null;
  return {
    schoolId: row.school_id,
    schoolName: row.school_name,
    conferenceId: row.conference_id,
    conferenceSlug: row.conference_slug,
    conferenceName: row.conference_name,
    conferenceShort: row.conference_short,
    division: row.division,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    active: row.expires_at > Date.now(),
  };
}

export function emailDomain(email) {
  return String(email).split('@')[1]?.toLowerCase() || '';
}

// Longest-suffix match: "mail.g.harvard.edu" -> tries the full domain, then
// "g.harvard.edu", then "harvard.edu". Returns every school registered for
// the most specific matching domain (several schools may share one).
export function schoolsForDomain(db, domain) {
  const labels = domain.split('.');
  const stmt = db.prepare(`
    SELECT s.id, s.name, c.short_name AS conference, c.division
    FROM school_domains d JOIN schools s ON s.id = d.school_id JOIN conferences c ON c.id = s.conference_id
    WHERE d.domain = ? AND s.active = 1 ORDER BY s.name`);
  for (let i = 0; i < labels.length - 1; i++) {
    const rows = stmt.all(labels.slice(i).join('.'));
    if (rows.length) return { matched: labels.slice(i).join('.'), schools: rows };
  }
  return { matched: null, schools: [] };
}

// Domains we accept for manual review when no school matches.
export function looksAcademic(domain) {
  return /\.edu$/.test(domain) || /\.(ac|edu)\.[a-z]{2}$/.test(domain) || /\.ca$/.test(domain);
}
