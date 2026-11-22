import config from '../config.js';
import { badRequest } from './errors.js';

// GIF search through GIPHY. The API key stays on the server, and comments
// store only a GIPHY id; the URL is always built here, so a comment can never
// point at an arbitrary site.

const API = 'https://api.giphy.com/v1/gifs';
const RATING = 'pg-13';
const ALLOWED_RATINGS = new Set(['g', 'pg', 'pg-13']);
const ID_RE = /^[A-Za-z0-9]{5,40}$/;

let fetchImpl = (...args) => fetch(...args);
// Tests swap in a fake GIPHY.
export function setGiphyFetch(fn) {
  fetchImpl = fn;
}

export const giphyEnabled = () => !!config.giphyKey;

export function gifUrl(id) {
  return `https://media.giphy.com/media/${id}/giphy.gif`;
}

// Ids our own search handed out recently, so picking one needs no extra call.
const seen = new Map();
function remember(id, rating) {
  seen.set(id, rating);
  if (seen.size > 5000) seen.delete(seen.keys().next().value);
}

async function call(path, params) {
  if (!giphyEnabled()) throw badRequest('GIF search isn’t set up on this server.');
  const qs = new URLSearchParams({ api_key: config.giphyKey, rating: RATING, ...params });
  let res;
  try {
    res = await fetchImpl(`${API}${path}?${qs}`);
  } catch {
    throw badRequest('Couldn’t reach GIPHY. Try again in a moment.');
  }
  if (!res.ok) throw badRequest('GIF search is unavailable right now.');
  return res.json();
}

function shape(g) {
  const small = g.images?.fixed_width_small || g.images?.fixed_width || {};
  const fw = g.images?.fixed_width || small;
  return {
    id: g.id,
    previewUrl: small.webp || small.url,
    url: fw.webp || fw.url,
    width: Number(fw.width) || 200,
    height: Number(fw.height) || 200,
    title: g.title || '',
  };
}

function list(json) {
  const out = [];
  for (const g of json.data || []) {
    if (!ID_RE.test(g.id || '') || !ALLOWED_RATINGS.has(g.rating)) continue;
    remember(g.id, g.rating);
    out.push(shape(g));
  }
  return out;
}

export async function searchGifs(q) {
  return list(await call('/search', { q: q.slice(0, 50), limit: '24', lang: 'en' }));
}

export async function trendingGifs() {
  return list(await call('/trending', { limit: '24' }));
}

// Validates a GIF id picked by the client and returns it.
export async function checkGifId(raw) {
  const id = String(raw || '');
  if (!ID_RE.test(id)) throw badRequest('That GIF isn’t valid.');
  if (!seen.has(id)) {
    const json = await call(`/${id}`, {});
    if (!json.data || json.data.id !== id) throw badRequest('That GIF isn’t available.');
    remember(id, json.data.rating);
  }
  if (!ALLOWED_RATINGS.has(seen.get(id))) throw badRequest('That GIF isn’t allowed here.');
  return id;
}
