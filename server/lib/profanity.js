import { SLURS, SLUR_ALLOWLIST } from '../data/slurs.js';

// ---- Slur detection --------------------------------------------------------

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '€': 'e', '¡': 'i' };

// Lowercase, strip accents, and undo leetspeak. Any other symbol that sits
// between letters (n.i.g.g.e.r, n*gger) is turned into a wildcard marker so a
// self-censored slur is still caught.
function normalize(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0134578@$!|€¡9]/g, (c) => LEET[c] ?? c);
}

// Turns "nigger" into /^n+i+g+g+e+r+(?:s|es|z|ies|ed)?$/ — stretched letters
// still match, but doubled letters must stay doubled (so "niger" doesn't).
// '?' in the input acts as a wildcard for one masked vowel.
function letterPattern(word) {
  return [...word].map((c) => (/[aeiou]/.test(c) ? `[${c}?]+` : `${c}+`)).join('');
}

const COMPILED = SLURS.map(({ word, inside }) => ({
  word,
  whole: new RegExp(`^${letterPattern(word)}(?:s|es|z|ies|ed)?$`),
  inside: inside ? new RegExp(letterPattern(word)) : null,
}));

function words(normalized) {
  // Letters spelled out one at a time with separators (n.i.g.g.e.r, f-a-g)
  // are joined back into a word.
  const joined = normalized.replace(/\b[a-z](?:[^a-z0-9]+[a-z]\b){2,}/g, (m) => m.replace(/[^a-z]/g, ''));
  // A symbol between two letters is a mask (n*gger) unless it's an apostrophe.
  const masked = joined.replace(/(?<=[a-z])[^a-z\s'’](?=[a-z])/g, '?');
  const tokens = masked.split(/[^a-z?]+/).filter(Boolean);
  // Re-join runs of single letters: "n i g g e r" -> "nigger".
  const out = [];
  let run = '';
  for (const t of tokens) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 2) out.push(run);
      run = '';
      out.push(t);
    }
  }
  if (run.length > 2) out.push(run);
  return out;
}

// Returns the slur found in the text, or null.
export function findSlur(text) {
  for (const token of words(normalize(String(text || '')))) {
    const plain = token.replace(/\?/g, '');
    if (SLUR_ALLOWLIST.includes(plain)) continue;
    for (const s of COMPILED) {
      if (s.whole.test(token) || (s.inside && s.inside.test(token))) return s.word;
    }
  }
  return null;
}

// ---- Expletive censoring ---------------------------------------------------
// Swearing is allowed but shown with its vowels starred: fuck -> f*ck.
// Each pattern marks the part to censor; patterns for short or common stems
// are whole-word only so "class", "Dickinson" or "Scunthorpe" are untouched.

const EXPLETIVES = [
  /fuck/gi,
  /\bfuk(?:s|ing|ed|er)?\b/gi,
  /shit/gi,
  /\bbitch\w*/gi,
  /\bbastards?\b/gi,
  /\bcunts?\b/gi,
  /\bcunty\b/gi,
  /\b(?:ass|asses|asshole|assholes|asshat|asswipe|jackass|dumbass|badass|smartass|fatass|lardass|kickass)\b/gi,
  /\b(?:dick|dicks|dickhead|dickheads|dickish)\b/gi,
  /\b(?:cock|cocks|cocksucker|cocksuckers)\b/gi,
  /\bpiss(?:ed|es|ing|y)?\b/gi,
  /\bpuss(?:y|ies)\b/gi,
  /\btwats?\b/gi,
  /\bwank(?:er|ers|ing|ed)?\b/gi,
  /\bbollocks\b/gi,
  /\bpricks?\b/gi,
  /\bsluts?\b/gi,
  /\bslutty\b/gi,
  /\bwhores?\b/gi,
  /\bdouche(?:bag|bags|s)?\b/gi,
  /\bmotherf\w*/gi,
];

function starVowels(word) {
  return word.replace(/[aeiouAEIOU]/g, '*');
}

export function censorExpletives(text) {
  let out = String(text || '');
  for (const re of EXPLETIVES) out = out.replace(re, starVowels);
  return out;
}
