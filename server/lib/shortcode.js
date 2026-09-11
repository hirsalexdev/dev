import { fetchText } from './http.js';

// Instagram shortcodes are base64url over this alphabet. Only the first 11
// characters encode the media primary key, the rest identifies the owner.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const PATTERNS = [
  { kind: 'post', regex: /\/(?:p)\/([A-Za-z0-9_-]+)/ },
  { kind: 'reel', regex: /\/(?:reels?|reel)\/([A-Za-z0-9_-]+)/ },
  { kind: 'igtv', regex: /\/(?:tv)\/([A-Za-z0-9_-]+)/ },
];

export function shortcodeToMediaId(shortcode) {
  let id = 0n;

  for (const char of shortcode.slice(0, 11)) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`invalid shortcode character: ${char}`);
    id = id * 64n + BigInt(index);
  }

  return id.toString();
}

/** Share links (/share/..., /reel/.../?igsh=) only resolve by following the redirect. */
async function followShareLink(url) {
  const response = await fetchText(url, { retries: 1 });
  const match = response.text.match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[0] : null;
}

export async function parseInstagramUrl(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Bitte eine Instagram-URL angeben.' };
  }

  let url;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: 'Das ist keine gültige URL.' };
  }

  if (!/(^|\.)instagram\.com$/.test(url.hostname) && !/(^|\.)instagr\.am$/.test(url.hostname)) {
    return { ok: false, error: 'Nur Instagram-Links werden unterstützt.' };
  }

  if (url.pathname.startsWith('/stories/')) {
    return {
      ok: false,
      error: 'Stories brauchen eine eingeloggte Session. Setze IG_SESSIONID, um sie zu aktivieren.',
    };
  }

  let path = url.pathname;

  if (path.startsWith('/share/')) {
    const resolved = await followShareLink(url.toString());
    if (!resolved) {
      return { ok: false, error: 'Share-Link konnte nicht aufgelöst werden.' };
    }
    path = resolved;
  }

  for (const { kind, regex } of PATTERNS) {
    const match = path.match(regex);
    if (match) {
      const shortcode = match[1];
      return {
        ok: true,
        kind,
        shortcode,
        mediaId: shortcodeToMediaId(shortcode),
        canonicalUrl: `https://www.instagram.com/${kind === 'reel' ? 'reel' : 'p'}/${shortcode}/`,
      };
    }
  }

  return { ok: false, error: 'Kein Post, Reel oder IGTV-Link erkannt.' };
}
