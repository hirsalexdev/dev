/**
 * Instagram hands out two very different JSON shapes depending on which door
 * you came through. Both get folded into one model here so the API surface and
 * the frontend never have to care which resolver answered.
 *
 * Model:
 *   { source, shortcode, kind, caption, author, media: [ { ... } ] }
 *   media item: { id, type, url, thumbnail, width, height, duration, ext }
 */

function pickLargest(candidates = []) {
  return [...candidates].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
}

function extensionFor(type, url) {
  const fromUrl = String(url ?? '').match(/\.(mp4|jpg|jpeg|png|webp|heic)(?:\?|$)/i);
  if (fromUrl) return fromUrl[1].toLowerCase();
  return type === 'video' ? 'mp4' : 'jpg';
}

function mediaItem({ id, type, url, thumbnail, width, height, duration }) {
  if (!url) return null;
  return {
    id: String(id ?? ''),
    type,
    url,
    thumbnail: thumbnail ?? (type === 'image' ? url : null),
    width: width ?? null,
    height: height ?? null,
    duration: duration ?? null,
    ext: extensionFor(type, url),
  };
}

/** GraphQL / embed shape: `shortcode_media` and its sidecar children. */
export function normalizeShortcodeMedia(node, source) {
  if (!node) return null;

  const toItem = (child) => {
    const isVideo = Boolean(child.is_video || child.video_url);
    return mediaItem({
      id: child.id ?? child.shortcode,
      type: isVideo ? 'video' : 'image',
      url: isVideo ? child.video_url : child.display_url ?? child.display_src,
      thumbnail: child.display_url ?? child.display_src ?? child.thumbnail_src,
      width: child.dimensions?.width,
      height: child.dimensions?.height,
      duration: child.video_duration ?? null,
    });
  };

  const children = node.edge_sidecar_to_children?.edges?.map((edge) => edge.node);
  const media = (children?.length ? children.map(toItem) : [toItem(node)]).filter(Boolean);

  if (!media.length) return null;

  return {
    source,
    shortcode: node.shortcode ?? null,
    kind: children?.length ? 'carousel' : media[0].type === 'video' ? 'video' : 'image',
    caption: node.edge_media_to_caption?.edges?.[0]?.node?.text ?? node.caption ?? null,
    author: {
      username: node.owner?.username ?? null,
      fullName: node.owner?.full_name ?? null,
      avatar: node.owner?.profile_pic_url ?? null,
    },
    media,
  };
}

/** Private-API shape: `items[0]` from /api/v1/media/<id>/info/. */
export function normalizeApiItem(item, source) {
  if (!item) return null;

  const toItem = (child) => {
    const video = pickLargest(child.video_versions ?? []);
    const image = pickLargest(child.image_versions2?.candidates ?? []);
    const isVideo = Boolean(video);

    return mediaItem({
      id: child.pk ?? child.id,
      type: isVideo ? 'video' : 'image',
      url: isVideo ? video.url : image?.url,
      thumbnail: image?.url ?? null,
      width: isVideo ? video.width : image?.width,
      height: isVideo ? video.height : image?.height,
      duration: child.video_duration ?? null,
    });
  };

  const children = item.carousel_media;
  const media = (children?.length ? children.map(toItem) : [toItem(item)]).filter(Boolean);

  if (!media.length) return null;

  return {
    source,
    shortcode: item.code ?? null,
    kind: children?.length ? 'carousel' : media[0].type === 'video' ? 'video' : 'image',
    caption: item.caption?.text ?? null,
    author: {
      username: item.user?.username ?? null,
      fullName: item.user?.full_name ?? null,
      avatar: item.user?.profile_pic_url ?? null,
    },
    media,
  };
}
