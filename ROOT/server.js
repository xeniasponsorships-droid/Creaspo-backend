require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');
 
const app = express();
const PORT = process.env.PORT || 3001;
 
app.use(cors({ origin: ['https://creaspo.netlify.app', 'http://localhost:5500', 'http://127.0.0.1:5500', process.env.FRONTEND_URL].filter(Boolean), credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });
 
// Init DB first, then mount routes
initDB().then(() => {
  app.use('/api/auth',         require('./routes/auth'));
  app.use('/api/users',        require('./routes/users'));
  app.use('/api/campaigns',    require('./routes/campaigns'));
  app.use('/api/deals',        require('./routes/deals'));
  app.use('/api/applications', require('./routes/applications'));
  app.use('/api/oauth',        require('./routes/oauth'));
  app.use('/api/verify',       require('./routes/verify'));
  app.use('/api/chat',         require('./routes/chat'));
 
  // POST /api/deals/:id/complete — either party marks deal as completed
  app.post('/api/deals/:id/complete', require('./middleware/auth').requireAuth, (req, res) => {
    const { getDB } = require('./db');
    const db = getDB();
    const deal = db.get('SELECT * FROM deals WHERE id = ?', [req.params.id]);
    if (!deal) return res.status(404).json({ error: 'Not found' });
    if (deal.sponsor_id !== req.user.id && deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!['active','changes','review'].includes(deal.status)) return res.status(400).json({ error: 'Cannot complete in this state' });
    const hist = JSON.parse(deal.history || '[]');
    hist.push({ at: Date.now(), by: req.user.role, action: 'marked completed' });
    db.run('UPDATE deals SET status = ?, history = ? WHERE id = ?', ['paid', JSON.stringify(hist), deal.id]);
    res.json(db.get('SELECT * FROM deals WHERE id = ?', [deal.id]));
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, _req, res, _next) => { console.error(err.message); res.status(500).json({ error: 'Server error' }); });
 
  app.listen(PORT, () => console.log(`\n🚀  http://localhost:${PORT}/api/health\n`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
 
