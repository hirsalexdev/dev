import crypto from 'node:crypto';

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value) {
  return String(value ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const secret = process.env.SIGNING_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SIGNING_SECRET) {
  console.warn(
    '[config] SIGNING_SECRET is not set, generated an ephemeral one. ' +
      'Download links break on every restart and across replicas. Set it in production.',
  );
}

export const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: bool(process.env.TRUST_PROXY, false),

  signingSecret: secret,
  // How long a signed download link stays valid. Instagram CDN signatures
  // usually outlive this, but there is no point handing out longer links.
  downloadTtlSeconds: int(process.env.DOWNLOAD_TTL_SECONDS, 60 * 30),

  // Resolver chain, tried left to right until one returns media.
  resolvers: list(process.env.RESOLVERS).length
    ? list(process.env.RESOLVERS)
    : ['embed', 'graphql', 'apiv1', 'ytdlp'],

  // Optional outbound proxy. Instagram blocks datacenter ranges hard, so a
  // residential/mobile proxy is what keeps a cloud deployment alive.
  proxyUrl: process.env.PROXY_URL || '',

  // Optional logged-in cookie. Raises success rate a lot, and risks the account.
  igSessionId: process.env.IG_SESSIONID || '',
  igDsUserId: process.env.IG_DS_USER_ID || '',
  igCsrfToken: process.env.IG_CSRFTOKEN || '',

  // GraphQL doc_ids rotate every few weeks. Override without a code change.
  graphqlDocIds: list(process.env.IG_DOC_IDS).length
    ? list(process.env.IG_DOC_IDS)
    : ['8845758582119845', '27130156389949648', '10015901848480474'],

  ytdlpBinary: process.env.YTDLP_BINARY || 'yt-dlp',
  ytdlpTimeoutMs: int(process.env.YTDLP_TIMEOUT_MS, 25_000),

  requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 15_000),
  maxRetries: int(process.env.MAX_RETRIES, 3),

  cacheTtlSeconds: int(process.env.CACHE_TTL_SECONDS, 60 * 20),
  cacheMaxEntries: int(process.env.CACHE_MAX_ENTRIES, 500),

  rateLimitWindowSeconds: int(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 20),

  // Hosts the streaming proxy is allowed to reach. Keep this tight: without it
  // /api/download is an open proxy and an SSRF hole.
  allowedMediaHosts: list(process.env.ALLOWED_MEDIA_HOSTS).length
    ? list(process.env.ALLOWED_MEDIA_HOSTS)
    : ['cdninstagram.com', 'fbcdn.net', 'instagram.com'],

  maxDownloadBytes: int(process.env.MAX_DOWNLOAD_BYTES, 512 * 1024 * 1024),
};
