import { config } from './lib/config.js';
import { cacheGet, cacheSet } from './lib/cache.js';
import { parseInstagramUrl } from './lib/shortcode.js';
import { signDownload, isAllowedMediaUrl } from './lib/sign.js';

import * as embed from './resolvers/embed.js';
import * as graphql from './resolvers/graphql.js';
import * as apiv1 from './resolvers/apiv1.js';
import * as ytdlp from './resolvers/ytdlp.js';

const REGISTRY = new Map([
  [embed.name, embed],
  [graphql.name, graphql],
  [apiv1.name, apiv1],
  [ytdlp.name, ytdlp],
]);

function safeFilename(target, item, index) {
  const user = (target.author?.username ?? 'instagram').replace(/[^a-zA-Z0-9._-]/g, '');
  const code = target.shortcode ?? 'media';
  const suffix = target.media.length > 1 ? `_${index + 1}` : '';
  return `${user}_${code}${suffix}.${item.ext}`;
}

/**
 * Runs the configured resolvers in order and returns the first result that
 * actually carries media. Every resolver targets a different Instagram surface,
 * so a chain survives any single one of them being closed off or rotated.
 */
export async function resolveInstagram(inputUrl) {
  const parsed = await parseInstagramUrl(inputUrl);
  if (!parsed.ok) {
    const error = new Error(parsed.error);
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = `media:${parsed.shortcode}`;
  const cached = cacheGet(cacheKey);
  const result = cached ?? (await runChain(parsed));

  if (!cached) {
    cacheSet(cacheKey, result);
  }

  // Signing happens per request, never cached: links carry their own expiry.
  return {
    ...result,
    cached: Boolean(cached),
    canonicalUrl: parsed.canonicalUrl,
    media: result.media.map((item, index) => {
      const filename = safeFilename(result, item, index);
      return {
        ...item,
        filename,
        // Proxying is what makes the browser save the file instead of opening
        // it, and it hides the (signed, expiring) CDN URL from the client.
        downloadUrl: isAllowedMediaUrl(item.url) ? signDownload(item.url, filename) : null,
        directUrl: item.url,
      };
    }),
  };
}

async function runChain(parsed) {
  const attempts = [];

  for (const resolverName of config.resolvers) {
    const resolver = REGISTRY.get(resolverName);
    if (!resolver) {
      attempts.push({ resolver: resolverName, error: 'unknown resolver' });
      continue;
    }

    const startedAt = Date.now();
    try {
      const result = await resolver.resolve(parsed);
      if (result?.media?.length) {
        return { ...result, attempts, tookMs: Date.now() - startedAt };
      }
      attempts.push({ resolver: resolverName, error: 'no media returned' });
    } catch (error) {
      attempts.push({ resolver: resolverName, error: error.message });
    }
  }

  const error = new Error(
    'Kein Resolver konnte den Post auflösen. Meist heißt das: privates Konto, gelöscht, ' +
      'altersbeschränkt, oder die Server-IP ist bei Instagram gesperrt.',
  );
  error.statusCode = 502;
  error.attempts = attempts;
  throw error;
}

export function availableResolvers() {
  return [...REGISTRY.keys()];
}
