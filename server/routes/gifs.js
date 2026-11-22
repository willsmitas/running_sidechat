import { Router } from 'express';
import { hit } from '../lib/ratelimit.js';
import { requireActive } from '../lib/session.js';
import { searchGifs, trendingGifs } from '../lib/giphy.js';

export default function gifRoutes() {
  const r = Router();

  r.get('/gifs/search', requireActive, async (req, res) => {
    hit(`gifs:${req.user.id}`, 60, 60_000);
    const q = String(req.query.q || '').trim();
    res.json({ gifs: q ? await searchGifs(q) : await trendingGifs() });
  });

  r.get('/gifs/trending', requireActive, async (req, res) => {
    hit(`gifs:${req.user.id}`, 60, 60_000);
    res.json({ gifs: await trendingGifs() });
  });

  return r;
}
