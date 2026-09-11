import { fetchJson } from '../lib/http.js';
import { normalizeApiItem } from '../lib/normalize.js';

/**
 * Instagram's own mobile/web private API. It needs the media primary key rather
 * than the shortcode (see lib/shortcode.js) and the web client's app id. The
 * app id is not optional: a wrong or missing `x-ig-app-id` is an instant 403.
 *
 * Anonymously this endpoint is the first one Instagram closes off, so in
 * practice it earns its keep once IG_SESSIONID is configured.
 */

export const name = 'apiv1';

export async function resolve({ shortcode, mediaId }) {
  const json = await fetchJson(`https://www.instagram.com/api/v1/media/${mediaId}/info/`, {
    retries: 1,
    headers: {
      'x-ig-app-id': '936619743392459',
      'x-asbd-id': '359341',
      'x-ig-www-claim': '0',
      'x-requested-with': 'XMLHttpRequest',
      referer: `https://www.instagram.com/p/${shortcode}/`,
      origin: 'https://www.instagram.com',
    },
  });

  const item = json?.items?.[0];
  const normalized = normalizeApiItem(item, 'apiv1');

  if (!normalized) {
    throw new Error(json?.message ? `api/v1 said: ${json.message}` : 'api/v1 returned no items');
  }

  return normalized;
}
