import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { HttpError, forbidden, notFound } from './lib/errors.js';
import { loadUser } from './lib/session.js';
import authRoutes from './routes/auth.js';
import collegeRoutes from './routes/college.js';
import boardRoutes from './routes/boards.js';
import postRoutes from './routes/posts.js';
import meRoutes from './routes/me.js';
import reportRoutes from './routes/reports.js';
import chatRoutes from './routes/chats.js';
import adminRoutes from './routes/admin.js';
import gifRoutes from './routes/gifs.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    });
    next();
  });

  app.use('/uploads', express.static(config.uploadDir, {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"),
  }));

  const api = express.Router();
  api.use(express.json({ limit: '64kb' }));
  api.use(express.urlencoded({ extended: false, limit: '64kb' }));
  // CSRF: state-changing requests must carry a custom header, which browsers
  // only let same-origin scripts send (cross-site forms can't set headers).
  api.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'backstretch') return next(forbidden('Missing request header.'));
    next();
  });
  api.use(loadUser(db));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes(db));
  api.use(collegeRoutes(db));
  api.use(boardRoutes(db));
  api.use(postRoutes(db));
  api.use(meRoutes(db));
  api.use(reportRoutes(db));
  api.use(chatRoutes(db));
  api.use(gifRoutes());
  api.use('/admin', adminRoutes(db));
  api.use((_req, _res, next) => next(notFound('No such endpoint.')));
  api.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That’s too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.name === 'MulterError') return res.status(400).json({ error: 'Upload failed.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our end.' });
  });
  app.use('/api', api);

  // Serve the built client (npm run build) with SPA fallback.
  const dist = path.join(config.root, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    const indexHtml = path.join(dist, 'index.html');
    app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  return app;
}
