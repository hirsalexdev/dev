import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Download links are HMAC-signed so /api/download only ever streams URLs this
 * service handed out itself. Without this the endpoint is a public open proxy.
 */
export function signDownload(url, filename) {
  const expiresAt = Math.floor(Date.now() / 1000) + config.downloadTtlSeconds;
  const payload = `${url}|${filename}|${expiresAt}`;
  const signature = crypto.createHmac('sha256', config.signingSecret).update(payload).digest('base64url');

  const params = new URLSearchParams({
    u: Buffer.from(url, 'utf8').toString('base64url'),
    fn: filename,
    e: String(expiresAt),
    s: signature,
  });

  return `/api/download?${params.toString()}`;
}

export function verifyDownload({ u, fn, e, s }) {
  if (!u || !fn || !e || !s) {
    return { ok: false, reason: 'missing parameters' };
  }

  const expiresAt = Number.parseInt(e, 10);
  if (!Number.isFinite(expiresAt)) {
    return { ok: false, reason: 'bad expiry' };
  }
  if (expiresAt < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'link expired' };
  }

  let url;
  try {
    url = Buffer.from(u, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'bad url encoding' };
  }

  const expected = crypto
    .createHmac('sha256', config.signingSecret)
    .update(`${url}|${fn}|${expiresAt}`)
    .digest('base64url');

  const given = Buffer.from(String(s));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return { ok: false, reason: 'bad signature' };
  }

  return { ok: true, url, filename: fn };
}

/** Second line of defence: even a validly signed URL must point at a CDN host. */
export function isAllowedMediaUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  return config.allowedMediaHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
  );
}
