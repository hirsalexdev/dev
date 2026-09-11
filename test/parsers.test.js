import test from 'node:test';
import assert from 'node:assert/strict';

import { shortcodeToMediaId, parseInstagramUrl } from '../server/lib/shortcode.js';
import { normalizeShortcodeMedia, normalizeApiItem } from '../server/lib/normalize.js';
import { parseEmbedHtml } from '../server/resolvers/embed.js';
import { signDownload, verifyDownload, isAllowedMediaUrl } from '../server/lib/sign.js';

// Fixtures mirror the two payload shapes Instagram actually serves. They are
// what lets the parsing be tested without depending on a live, rate-limited,
// frequently-changing upstream.

const VIDEO_NODE = {
  __typename: 'XDTGraphVideo',
  id: '3190205625856910372',
  shortcode: 'CxF4x1Bp2Qk',
  is_video: true,
  video_url: 'https://scontent.cdninstagram.com/v/t50/reel.mp4?oh=abc',
  display_url: 'https://scontent.cdninstagram.com/v/t51/cover.jpg',
  dimensions: { width: 1080, height: 1920 },
  video_duration: 14.233,
  owner: { username: 'nasa', full_name: 'NASA', profile_pic_url: 'https://scontent.cdninstagram.com/a.jpg' },
  edge_media_to_caption: { edges: [{ node: { text: 'Ein Testtext' } }] },
};

const SIDECAR_NODE = {
  __typename: 'XDTGraphSidecar',
  shortcode: 'CxF4x1Bp2Qk',
  owner: { username: 'nasa', full_name: 'NASA', profile_pic_url: null },
  edge_media_to_caption: { edges: [] },
  edge_sidecar_to_children: {
    edges: [
      {
        node: {
          id: '1',
          is_video: false,
          display_url: 'https://scontent.cdninstagram.com/one.jpg',
          dimensions: { width: 1440, height: 1440 },
        },
      },
      {
        node: {
          id: '2',
          is_video: true,
          video_url: 'https://scontent.cdninstagram.com/two.mp4',
          display_url: 'https://scontent.cdninstagram.com/two.jpg',
          dimensions: { width: 1080, height: 1350 },
        },
      },
    ],
  },
};

const API_ITEM = {
  pk: '3190205625856910372',
  code: 'CxF4x1Bp2Qk',
  media_type: 2,
  video_duration: 14.233,
  caption: { text: 'Aus der privaten API' },
  user: { username: 'nasa', full_name: 'NASA', profile_pic_url: 'https://scontent.cdninstagram.com/a.jpg' },
  image_versions2: {
    candidates: [
      { url: 'https://scontent.cdninstagram.com/small.jpg', width: 320, height: 568 },
      { url: 'https://scontent.cdninstagram.com/large.jpg', width: 1080, height: 1920 },
    ],
  },
  video_versions: [
    { url: 'https://scontent.cdninstagram.com/low.mp4', width: 480, height: 852, type: 103 },
    { url: 'https://scontent.cdninstagram.com/high.mp4', width: 1080, height: 1920, type: 101 },
  ],
};

/** Builds the double-encoded `contextJSON` blob the embed page actually ships. */
function embedHtmlWith(node) {
  const context = JSON.stringify({ gql_data: { shortcode_media: node } });
  return `<html><body><script>requireLazy(["PolarisEmbedSDK"],function(){});</script>
<script type="application/json" data-sjs>{"require":[["ScheduledServerJS",null,[{"__bbox":{"contextJSON":${JSON.stringify(
    context,
  )}}}]]]}</script></body></html>`;
}

test('shortcode wird korrekt in die media_id umgerechnet', () => {
  assert.equal(shortcodeToMediaId('CxF4x1Bp2Qk'), '3190205625856910372');
  // Zeichen jenseits des elften kodieren den Besitzer und dürfen nichts ändern.
  assert.equal(shortcodeToMediaId('CxF4x1Bp2Qk_extra'), shortcodeToMediaId('CxF4x1Bp2Qk'));
});

test('URL-Parser akzeptiert alle Post-Formen und lehnt den Rest ab', async () => {
  for (const [url, kind] of [
    ['https://www.instagram.com/p/CxF4x1Bp2Qk/', 'post'],
    ['https://www.instagram.com/reel/CxF4x1Bp2Qk/?igsh=xyz', 'reel'],
    ['https://instagram.com/reels/CxF4x1Bp2Qk', 'reel'],
    ['https://www.instagram.com/tv/CxF4x1Bp2Qk/', 'igtv'],
    ['instagram.com/p/CxF4x1Bp2Qk/', 'post'],
  ]) {
    const parsed = await parseInstagramUrl(url);
    assert.equal(parsed.ok, true, `${url} sollte akzeptiert werden`);
    assert.equal(parsed.kind, kind);
    assert.equal(parsed.shortcode, 'CxF4x1Bp2Qk');
  }

  for (const url of ['https://youtube.com/watch?v=1', 'https://evil.com/p/abc', '', 'kein-link']) {
    assert.equal((await parseInstagramUrl(url)).ok, false, `${url} sollte abgelehnt werden`);
  }
});

test('Stories werden mit einem verständlichen Hinweis abgelehnt', async () => {
  const parsed = await parseInstagramUrl('https://www.instagram.com/stories/nasa/123/');
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /IG_SESSIONID/);
});

test('GraphQL-Video wird normalisiert', () => {
  const result = normalizeShortcodeMedia(VIDEO_NODE, 'test');
  assert.equal(result.kind, 'video');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].type, 'video');
  assert.equal(result.media[0].url, VIDEO_NODE.video_url);
  assert.equal(result.media[0].ext, 'mp4');
  assert.equal(result.media[0].thumbnail, VIDEO_NODE.display_url);
  assert.equal(result.author.username, 'nasa');
  assert.equal(result.caption, 'Ein Testtext');
});

test('Karussell liefert alle Kinder in der richtigen Reihenfolge', () => {
  const result = normalizeShortcodeMedia(SIDECAR_NODE, 'test');
  assert.equal(result.kind, 'carousel');
  assert.deepEqual(
    result.media.map((item) => item.type),
    ['image', 'video'],
  );
  assert.equal(result.media[1].url, 'https://scontent.cdninstagram.com/two.mp4');
});

test('api/v1 wählt jeweils die größte verfügbare Variante', () => {
  const result = normalizeApiItem(API_ITEM, 'test');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].url, 'https://scontent.cdninstagram.com/high.mp4');
  assert.equal(result.media[0].width, 1080);
  assert.equal(result.media[0].thumbnail, 'https://scontent.cdninstagram.com/large.jpg');
  assert.equal(result.caption, 'Aus der privaten API');
});

test('api/v1 Karussell wird flachgeklopft', () => {
  const result = normalizeApiItem({ ...API_ITEM, carousel_media: [API_ITEM, API_ITEM] }, 'test');
  assert.equal(result.kind, 'carousel');
  assert.equal(result.media.length, 2);
});

test('Embed-Seite: contextJSON wird aus dem doppelt kodierten Blob gelesen', () => {
  const result = parseEmbedHtml(embedHtmlWith(VIDEO_NODE), 'CxF4x1Bp2Qk');
  assert.ok(result, 'contextJSON sollte gefunden werden');
  assert.equal(result.source, 'embed:contextJSON');
  assert.equal(result.media[0].url, VIDEO_NODE.video_url);
});

test('Embed-Seite: Markup-Fallback greift ohne JSON-Payload', () => {
  const html =
    '<html><img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/pic.jpg?a=1&amp;b=2"/>' +
    '<span>"username":"nasa"</span></html>';
  const result = parseEmbedHtml(html, 'CxF4x1Bp2Qk');
  assert.equal(result.source, 'embed:markup');
  assert.equal(result.media[0].type, 'image');
  assert.equal(result.media[0].url, 'https://scontent.cdninstagram.com/pic.jpg?a=1&b=2');
});

test('Embed-Seite ohne Medien liefert null statt zu werfen', () => {
  assert.equal(parseEmbedHtml('<html><body>Sorry, this page is not available.</body></html>', 'X'), null);
});

test('Download-Links sind signiert und manipulationssicher', () => {
  const url = 'https://scontent.cdninstagram.com/v/t50/reel.mp4?oh=abc&oe=def';
  const params = Object.fromEntries(new URLSearchParams(signDownload(url, 'nasa_X.mp4').split('?')[1]));

  assert.deepEqual(verifyDownload(params), { ok: true, url, filename: 'nasa_X.mp4' });

  const swapped = { ...params, u: Buffer.from('https://evil.com/x.mp4').toString('base64url') };
  assert.equal(verifyDownload(swapped).ok, false);

  assert.equal(verifyDownload({ ...params, e: '1000' }).reason, 'link expired');
  assert.equal(verifyDownload({}).ok, false);
});

test('Host-Allowlist lässt nur echte CDN-Hosts durch', () => {
  assert.equal(isAllowedMediaUrl('https://scontent-fra5-1.cdninstagram.com/x.mp4'), true);
  assert.equal(isAllowedMediaUrl('https://video.xx.fbcdn.net/x.mp4'), true);
  assert.equal(isAllowedMediaUrl('https://evil.com/x.mp4'), false);
  // Der Suffix-Trick: evil-cdninstagram.com darf nicht als Subdomain durchgehen.
  assert.equal(isAllowedMediaUrl('https://evil-cdninstagram.com/x.mp4'), false);
  assert.equal(isAllowedMediaUrl('http://scontent.cdninstagram.com/x.mp4'), false);
  assert.equal(isAllowedMediaUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedMediaUrl('http://169.254.169.254/latest/meta-data/'), false);
});
