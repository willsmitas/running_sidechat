import { badRequest } from './errors.js';
import { getSettings } from './settings.js';
import { censorExpletives, findSlur } from './profanity.js';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// North American phone numbers in common formats; avoids matching race times
// like 3:59.4 or splits like 64-66-65.
const PHONE_RE = /(?<![\d:.])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d:])/;

export function cleanText(raw, { field = 'Text', min = 1, max = 2000 } = {}) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (text.length < min) throw badRequest(min <= 1 ? `${field} can't be empty.` : `${field} must be at least ${min} characters.`);
  if (text.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`);
  return text;
}

// Validates user text and returns the version to store: slurs and banned
// words are refused, expletives are kept but censored (fuck -> f*ck).
export function checkContent(db, text, { contactInfo = true } = {}) {
  const s = getSettings(db);
  if (findSlur(text)) throw badRequest('That contains a slur, which isn’t allowed here.');
  if (contactInfo && s.blockContactInfo) {
    if (EMAIL_RE.test(text)) throw badRequest('Posts can’t include email addresses. Keep it anonymous — for you and everyone else.');
    if (PHONE_RE.test(text)) throw badRequest('Posts can’t include phone numbers.');
  }
  const lower = text.toLowerCase();
  for (const w of s.bannedWords) {
    if (w && lower.includes(w.toLowerCase())) throw badRequest('That contains language that isn’t allowed here.');
  }
  return s.censorExpletives ? censorExpletives(text) : text;
}
