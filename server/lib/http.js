import { Agent, ProxyAgent, interceptors, request as undiciRequest } from 'undici';
import { config } from './config.js';

// Instagram fingerprints clients. A plausible, current desktop UA is the
// cheapest way to look like a browser; rotating avoids one sticky signature.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
];

// undici v7 dropped the per-request `maxRedirections` option: following
// redirects is now a dispatcher-level interceptor. Instagram redirects a lot
// (share links, login walls, CDN hops), so this is not optional.
const baseAgent = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : new Agent();

const redirectingAgents = new Map();

function agentFor(maxRedirections) {
  let agent = redirectingAgents.get(maxRedirections);
  if (!agent) {
    agent = baseAgent.compose(
      interceptors.redirect({ maxRedirections, throwOnMaxRedirects: false }),
    );
    redirectingAgents.set(maxRedirections, agent);
  }
  return agent;
}

export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function dispatcher(maxRedirections = 5) {
  return agentFor(maxRedirections);
}

export function instagramCookieHeader() {
  const parts = [];
  if (config.igSessionId) parts.push(`sessionid=${config.igSessionId}`);
  if (config.igDsUserId) parts.push(`ds_user_id=${config.igDsUserId}`);
  if (config.igCsrfToken) parts.push(`csrftoken=${config.igCsrfToken}`);
  parts.push('ig_did=' + crypto.randomUUID().toUpperCase());
  return parts.join('; ');
}

export function baseHeaders(extra = {}) {
  return {
    'user-agent': randomUserAgent(),
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'sec-fetch-site': 'same-origin',
    'sec-ch-ua-platform': '"Windows"',
    cookie: instagramCookieHeader(),
    ...extra,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Fetch with UA rotation, optional proxy, and exponential backoff on the
 * statuses Instagram uses for throttling (429) and transient failure (5xx).
 */
export async function fetchText(url, options = {}) {
  const { method = 'GET', headers = {}, body, retries = config.maxRetries } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await sleep(Math.min(2 ** attempt * 1000, 16_000) + Math.random() * 400);
    }

    try {
      const response = await undiciRequest(url, {
        method,
        headers: baseHeaders(headers),
        body,
        dispatcher: dispatcher(5),
        headersTimeout: config.requestTimeoutMs,
        bodyTimeout: config.requestTimeoutMs,
      });

      const text = await response.body.text();

      if (response.statusCode === 429 || response.statusCode >= 500) {
        lastError = new HttpError(response.statusCode, `upstream ${response.statusCode}`, text);
        continue;
      }

      return { status: response.statusCode, headers: response.headers, text };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('request failed');
}

export async function fetchJson(url, options = {}) {
  const response = await fetchText(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
  });

  if (response.status >= 400) {
    throw new HttpError(response.status, `upstream ${response.status}`, response.text.slice(0, 400));
  }

  try {
    return JSON.parse(response.text);
  } catch {
    throw new HttpError(response.status, 'upstream returned non-JSON', response.text.slice(0, 400));
  }
}
