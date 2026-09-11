import express from 'express';
import { request as undiciRequest } from 'undici';
import { verifyDownload, isAllowedMediaUrl } from '../lib/sign.js';
import { baseHeaders, dispatcher } from '../lib/http.js';
import { config } from '../lib/config.js';

export const downloadRouter = express.Router();

/**
 * Streams a CDN object through this server. Two reasons it exists at all:
 *
 *  1. Instagram's CDN sends no `Content-Disposition`, so a plain <a download>
 *     across origins just opens the video in a tab. Proxying lets us set it.
 *  2. The CDN URLs are signed and expire, and leaking them is pointless churn.
 *
 * Both guards below matter: the HMAC proves this service minted the link, and
 * the host allowlist keeps a leaked secret from turning this into an open proxy.
 */
downloadRouter.get('/download', async (req, res) => {
  const verified = verifyDownload(req.query);
  if (!verified.ok) {
    return res.status(403).type('text/plain').send(`Download abgelehnt: ${verified.reason}`);
  }

  if (!isAllowedMediaUrl(verified.url)) {
    return res.status(403).type('text/plain').send('Download abgelehnt: Host nicht erlaubt.');
  }

  let upstream;
  try {
    upstream = await undiciRequest(verified.url, {
      headers: baseHeaders({
        referer: 'https://www.instagram.com/',
        accept: '*/*',
        // Pass the browser's range request through so seeking and resume work.
        ...(req.headers.range ? { range: req.headers.range } : {}),
      }),
      dispatcher: dispatcher(3),
      headersTimeout: config.requestTimeoutMs,
      bodyTimeout: 0,
    });
  } catch (error) {
    console.error('[download] upstream failed:', error.message);
    return res.status(502).type('text/plain').send('CDN nicht erreichbar.');
  }

  if (upstream.statusCode >= 400) {
    upstream.body.dump();
    return res
      .status(upstream.statusCode === 403 ? 410 : 502)
      .type('text/plain')
      .send(
        upstream.statusCode === 403
          ? 'Der CDN-Link ist abgelaufen. Bitte den Post neu auflösen.'
          : `CDN antwortete mit ${upstream.statusCode}.`,
      );
  }

  const length = Number.parseInt(upstream.headers['content-length'] ?? '', 10);
  if (Number.isFinite(length) && length > config.maxDownloadBytes) {
    upstream.body.dump();
    return res.status(413).type('text/plain').send('Datei ist größer als das konfigurierte Limit.');
  }

  const safeName = verified.filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  res.status(upstream.statusCode);
  res.set({
    'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Cache-Control': 'private, max-age=0, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (upstream.headers['content-length']) res.set('Content-Length', upstream.headers['content-length']);
  if (upstream.headers['content-range']) res.set('Content-Range', upstream.headers['content-range']);
  if (upstream.headers['accept-ranges']) res.set('Accept-Ranges', upstream.headers['accept-ranges']);

  upstream.body.on('error', (error) => {
    console.error('[download] stream error:', error.message);
    res.destroy();
  });

  upstream.body.pipe(res);
});
