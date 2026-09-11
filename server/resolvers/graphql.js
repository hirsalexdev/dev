import { fetchJson } from '../lib/http.js';
import { config } from '../lib/config.js';
import { normalizeShortcodeMedia } from '../lib/normalize.js';

/**
 * The same GraphQL call the web client makes for a post page. It is the richest
 * anonymous source, but every `doc_id` is a moving target: Instagram rotates
 * them every two to four weeks as an anti-scraping measure. That is why the id
 * list is configuration (IG_DOC_IDS), not a constant, and why each id in the
 * list is tried in turn.
 */

export const name = 'graphql';

async function queryWithDocId(shortcode, docId) {
  const body = new URLSearchParams({
    doc_id: docId,
    variables: JSON.stringify({
      shortcode,
      fetch_tagged_user_count: null,
      hoisted_comment_id: null,
      hoisted_reply_id: null,
    }),
    server_timestamps: 'true',
  }).toString();

  const json = await fetchJson('https://www.instagram.com/graphql/query', {
    method: 'POST',
    body,
    retries: 1,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-ig-app-id': '936619743392459',
      'x-fb-friendly-name': 'PolarisPostRootQueryRelayPreloader',
      'x-fb-lsd': 'AVqbxe3J_YA',
      'x-asbd-id': '359341',
      'x-ig-www-claim': '0',
      origin: 'https://www.instagram.com',
      referer: `https://www.instagram.com/p/${shortcode}/`,
    },
  });

  return json?.data?.xdt_shortcode_media ?? json?.data?.shortcode_media ?? null;
}

export async function resolve({ shortcode }) {
  const failures = [];

  for (const docId of config.graphqlDocIds) {
    try {
      const node = await queryWithDocId(shortcode, docId);
      const normalized = normalizeShortcodeMedia(node, `graphql:${docId}`);
      if (normalized) return normalized;
      failures.push(`${docId}: empty payload`);
    } catch (error) {
      failures.push(`${docId}: ${error.message}`);
    }
  }

  throw new Error(`all doc_ids failed (${failures.join('; ')})`);
}
