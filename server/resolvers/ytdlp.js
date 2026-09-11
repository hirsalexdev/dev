import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../lib/config.js';

const execFileAsync = promisify(execFile);

/**
 * Last resort, and the one that ages best. yt-dlp's Instagram extractor is
 * maintained by a large community, so when Instagram rotates a doc_id or closes
 * an endpoint the fix arrives as a `pip install -U yt-dlp` rather than as work
 * in this repository. The trade-off is an extra binary and a slower response.
 */

export const name = 'ytdlp';

function toMedia(info) {
  const entries = info._type === 'playlist' ? info.entries ?? [] : [info];

  return entries
    .map((entry, index) => {
      const isVideo = entry.vcodec !== 'none' && (entry.ext === 'mp4' || entry.duration != null);
      const url = entry.url ?? entry.formats?.at(-1)?.url;
      if (!url) return null;

      return {
        id: String(entry.id ?? index),
        type: isVideo ? 'video' : 'image',
        url,
        thumbnail: entry.thumbnail ?? null,
        width: entry.width ?? null,
        height: entry.height ?? null,
        duration: entry.duration ?? null,
        ext: isVideo ? 'mp4' : 'jpg',
      };
    })
    .filter(Boolean);
}

export async function resolve({ canonicalUrl, shortcode }) {
  let stdout;

  try {
    ({ stdout } = await execFileAsync(
      config.ytdlpBinary,
      ['--dump-single-json', '--no-warnings', '--no-playlist-reverse', canonicalUrl],
      { timeout: config.ytdlpTimeoutMs, maxBuffer: 20 * 1024 * 1024 },
    ));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${config.ytdlpBinary} is not installed`);
    }
    throw new Error(`yt-dlp failed: ${String(error.stderr || error.message).slice(0, 200)}`);
  }

  const info = JSON.parse(stdout);
  const media = toMedia(info);

  if (!media.length) {
    throw new Error('yt-dlp returned no downloadable formats');
  }

  return {
    source: 'ytdlp',
    shortcode: shortcode ?? info.id ?? null,
    kind: media.length > 1 ? 'carousel' : media[0].type === 'video' ? 'video' : 'image',
    caption: info.description ?? null,
    author: {
      username: info.uploader_id ?? info.uploader ?? null,
      fullName: info.uploader ?? null,
      avatar: null,
    },
    media,
  };
}
