const form = document.querySelector('#form');
const input = document.querySelector('#url');
const submit = document.querySelector('#submit');
const statusBox = document.querySelector('#status');
const resultBox = document.querySelector('#result');

function setStatus(message, kind = 'busy') {
  if (!message) {
    statusBox.hidden = true;
    return;
  }
  statusBox.hidden = false;
  statusBox.className = `status ${kind}`;
  statusBox.textContent = message;
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function card(item, index) {
  const element = document.createElement('article');
  element.className = 'card';

  const preview = document.createElement('img');
  preview.className = 'preview';
  preview.loading = 'lazy';
  preview.alt = `Vorschau ${index + 1}`;
  // Thumbnails come straight from the CDN: no reason to spend our own bandwidth
  // on them, and they are public images anyway.
  preview.src = item.thumbnail ?? item.directUrl;
  preview.referrerPolicy = 'no-referrer';
  element.append(preview);

  const body = document.createElement('div');
  body.className = 'body';

  const badge = document.createElement('span');
  badge.className = 'badge';
  const bits = [item.type === 'video' ? 'Video' : 'Bild'];
  if (item.width && item.height) bits.push(`${item.width}x${item.height}`);
  const duration = formatDuration(item.duration);
  if (duration) bits.push(duration);
  badge.textContent = bits.join(' · ');
  body.append(badge);

  if (item.downloadUrl) {
    const link = document.createElement('a');
    link.className = 'dl';
    link.href = item.downloadUrl;
    link.textContent = item.type === 'video' ? 'Video laden' : 'Bild laden';
    link.setAttribute('download', item.filename);
    body.append(link);
  } else {
    const note = document.createElement('span');
    note.className = 'badge';
    note.textContent = 'Kein erlaubter CDN-Host';
    body.append(note);
  }

  element.append(body);
  return element;
}

function render(data) {
  resultBox.replaceChildren();
  resultBox.hidden = false;

  const meta = document.createElement('div');
  meta.className = 'meta';

  if (data.author?.avatar) {
    const avatar = document.createElement('img');
    avatar.src = data.author.avatar;
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';
    meta.append(avatar);
  }

  const who = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'who';
  name.textContent = data.author?.username ? `@${data.author.username}` : 'Unbekanntes Konto';
  const src = document.createElement('div');
  src.className = 'src';
  src.textContent = `${data.media.length} Datei(en) · Quelle: ${data.source}${data.cached ? ' · aus Cache' : ''}`;
  who.append(name, src);
  meta.append(who);
  resultBox.append(meta);

  const grid = document.createElement('div');
  grid.className = 'grid';
  data.media.forEach((item, index) => grid.append(card(item, index)));
  resultBox.append(grid);

  if (data.caption) {
    const caption = document.createElement('div');
    caption.className = 'caption';
    caption.textContent = data.caption;
    resultBox.append(caption);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const url = input.value.trim();
  if (!url) return;

  submit.disabled = true;
  resultBox.hidden = true;
  setStatus('Post wird aufgelöst...');

  try {
    const response = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      setStatus(data.error ?? `Fehler ${response.status}`, 'error');
      return;
    }

    setStatus('');
    render(data);
  } catch (error) {
    setStatus(`Netzwerkfehler: ${error.message}`, 'error');
  } finally {
    submit.disabled = false;
  }
});
