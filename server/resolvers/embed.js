import { fetchText } from '../lib/http.js';
import { normalizeShortcodeMedia } from '../lib/normalize.js';

/**
 * The oEmbed page is the last anonymous surface Instagram still serves without
 * a session. It renders a stripped-down post whose payload sits in a
 * JSON-inside-JSON blob called `contextJSON`. No app id, no doc_id, no cookie,
 * which also means nothing here rotates every few weeks.
 */

/** Reads the JSON string literal that follows `marker`, honouring backslash escapes. */
function readJsonStringAfter(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) return null;

  let index = start + marker.length;
  let out = '';

  while (index < html.length) {
    const char = html[index];

    if (char === '\\') {
      out += char + html[index + 1];
      index += 2;
      continue;
    }
    if (char === '"') break;

    out += char;
    index += 1;
  }

  try {
    return JSON.parse(`"${out}"`);
  } catch {
    return null;
  }
}

/** Fallback for embeds that render markup only, with no usable JSON payload. */
function scrapeBareMarkup(html, shortcode) {
  const videoUrl = html.match(/"video_url":"([^"]+)"/)?.[1];
  const imageUrl =
    html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/)?.[1] ??
    html.match(/"display_url":"([^"]+)"/)?.[1];
  const username = html.match(/"username":"([^"]+)"/)?.[1] ?? null;

  const decode = (value) => (value ? value.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&') : null);

  const url = decode(videoUrl) ?? decode(imageUrl);
  if (!url) return null;

  return normalizeShortcodeMedia(
    {
      shortcode,
      is_video: Boolean(videoUrl),
      video_url: decode(videoUrl),
      display_url: decode(imageUrl),
      owner: { username },
    },
    'embed:markup',
  );
}

/** Network-free so the parsing can be tested against fixtures. */
export function parseEmbedHtml(html, shortcode) {
  const contextJson = readJsonStringAfter(html, '"contextJSON":"');

  if (contextJson) {
    try {
      const context = JSON.parse(contextJson);
      const node = context?.gql_data?.shortcode_media ?? context?.shortcode_media;
      const normalized = normalizeShortcodeMedia(node, 'embed:contextJSON');
      if (normalized) return normalized;
    } catch {
      // Fall through to the markup scrape below.
    }
  }

  return scrapeBareMarkup(html, shortcode);
}

export const name = 'embed';

export async function resolve({ shortcode }) {
  const response = await fetchText(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'sec-fetch-dest': 'iframe',
      'sec-fetch-mode': 'navigate',
      referer: 'https://www.instagram.com/',
    },
  });

  if (response.status >= 400) {
    throw new Error(`embed page returned ${response.status}`);
  }

  const parsed = parseEmbedHtml(response.text, shortcode);
  if (parsed) return parsed;

  throw new Error('embed page contained no media payload (post is private, deleted or age-gated)');
}
