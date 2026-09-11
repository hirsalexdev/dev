import express from 'express';
import { resolveInstagram, availableResolvers } from '../resolve.js';
import { config } from '../lib/config.js';
import { cacheStats } from '../lib/cache.js';
import { rateLimit } from '../lib/ratelimit.js';

export const apiRouter = express.Router();

apiRouter.get('/health', (req, res) => {
  res.json({
    ok: true,
    resolvers: { configured: config.resolvers, available: availableResolvers() },
    proxy: Boolean(config.proxyUrl),
    session: Boolean(config.igSessionId),
    cache: cacheStats(),
  });
});

apiRouter.post('/resolve', async (req, res) => {
  const limit = rateLimit(req.clientIp);
  res.set('X-RateLimit-Remaining', String(limit.remaining));

  if (!limit.allowed) {
    res.set('Retry-After', String(limit.resetInSeconds));
    return res.status(429).json({
      ok: false,
      error: `Zu viele Anfragen. Bitte ${limit.resetInSeconds}s warten.`,
    });
  }

  try {
    const result = await resolveInstagram(req.body?.url);
    return res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      console.error('[resolve]', error.message, error.attempts ?? '');
    }
    return res.status(status).json({
      ok: false,
      error: error.message,
      attempts: error.attempts ?? undefined,
    });
  }
});
