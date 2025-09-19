import express from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.PIPEDRIVE_JWT_SECRET;

if (!JWT_SECRET) {
  console.warn('WARNING: PIPEDRIVE_JWT_SECRET not set.');
}

app.set('trust proxy', 1);
app.use('/static', express.static(path.join(__dirname, 'public')));

// Healthcheck (ohne Auth)
app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Panel-Route unter /pd_ui/testpanel – erwartet ?token=...
app.get('/pd_ui/testpanel', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(401).send('Missing token');
  try {
    jwt.verify(token, JWT_SECRET);
    res.sendFile(path.join(__dirname, 'public', 'panel.html'));
  } catch (e) {
    console.error('JWT invalid:', e.message);
    return res.status(401).send('Unauthorized');
  }
});

app.listen(PORT, () => {
  console.log(`App listening on ${PORT}`);
});
