#!/usr/bin/env node
/**
 * Diagnostic CLI: runs every resolver against one URL and reports which of them
 * still work from this machine's IP. Run it after a deploy, and again whenever
 * downloads start failing, to tell "Instagram changed something" apart from
 * "this IP is blocked".
 *
 *   node scripts/probe.js https://www.instagram.com/reel/XXXX/
 */
import { parseInstagramUrl } from '../server/lib/shortcode.js';
import { availableResolvers } from '../server/resolve.js';

import * as embed from '../server/resolvers/embed.js';
import * as graphql from '../server/resolvers/graphql.js';
import * as apiv1 from '../server/resolvers/apiv1.js';
import * as ytdlp from '../server/resolvers/ytdlp.js';

const RESOLVERS = [embed, graphql, apiv1, ytdlp];

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/probe.js <instagram-url>');
  console.error(`Verfügbare Resolver: ${availableResolvers().join(', ')}`);
  process.exit(1);
}

const parsed = await parseInstagramUrl(target);
if (!parsed.ok) {
  console.error(`URL abgelehnt: ${parsed.error}`);
  process.exit(1);
}

console.log(`shortcode : ${parsed.shortcode}`);
console.log(`media_id  : ${parsed.mediaId}`);
console.log(`kind      : ${parsed.kind}\n`);

let anyWorked = false;

for (const resolver of RESOLVERS) {
  const startedAt = Date.now();
  process.stdout.write(`${resolver.name.padEnd(8)} ... `);

  try {
    const result = await resolver.resolve(parsed);
    anyWorked = true;
    console.log(
      `OK   ${String(Date.now() - startedAt).padStart(5)}ms  ` +
        `${result.media.length} Datei(en), Quelle ${result.source}`,
    );
    for (const item of result.media) {
      console.log(`           - ${item.type} ${item.width ?? '?'}x${item.height ?? '?'} ${item.url.slice(0, 90)}...`);
    }
  } catch (error) {
    console.log(`FAIL ${String(Date.now() - startedAt).padStart(5)}ms  ${error.message}`);
  }
}

process.exit(anyWorked ? 0 : 1);
