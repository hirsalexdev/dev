import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { config } from './lib/config.js';
import { apiRouter } from './routes/api.js';
import { downloadRouter } from './routes/download.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

if (config.trustProxy) {
  app.set('trust proxy', true);
}
app.disable('x-powered-by');

app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  req.clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  next();
});

app.use('/api', apiRouter);
app.use('/api', downloadRouter);

app.use(express.static(path.join(here, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

app.use((error, req, res, next) => {
  console.error('[unhandled]', error);
  if (res.headersSent) return next(error);
  res.status(500).json({ ok: false, error: 'Interner Fehler' });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`SnapGrab läuft auf http://${config.host}:${config.port}`);
  console.log(`Resolver-Kette: ${config.resolvers.join(' -> ')}`);
  if (!config.proxyUrl) {
    console.log(
      '[hinweis] Kein PROXY_URL gesetzt. Auf Cloud-/Datacenter-IPs blockt Instagram sehr schnell.',
    );
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} empfangen, fahre herunter.`);
    server.close(() => process.exit(0));
  });
}
