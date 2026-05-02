const router = require('express').Router();
const { getDB } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const safe = u => { const { password, ...r } = u; r.profile = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile; return r; };

router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const rows = req.user.role === 'admin'
    ? db.all("SELECT * FROM users WHERE role != 'admin'")
    : req.user.role === 'sponsor'
      ? db.all("SELECT * FROM users WHERE role = 'creator' AND status = 'active'")
      : db.all("SELECT * FROM users WHERE role = 'sponsor' AND status = 'active'");
  res.json(rows.map(safe));
});

router.get('/:id', requireAuth, (req, res) => {
  const user = getDB().get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(safe(user));
});

router.patch('/me/profile', requireAuth, (req, res) => {
  const db = getDB();
  const { name, profile } = req.body;
  const current = JSON.parse(db.get('SELECT profile FROM users WHERE id = ?', [req.user.id])?.profile || '{}');
  const merged = { ...current, ...(profile || {}) };
  db.run('UPDATE users SET profile = ?, name = ? WHERE id = ?', [JSON.stringify(merged), name || req.user.name, req.user.id]);
  res.json(safe(db.get('SELECT * FROM users WHERE id = ?', [req.user.id])));
});

router.post('/:id/kick', requireAuth, requireRole('admin'), (req, res) => {
  const user = getDB().get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Cannot remove admin' });
  getDB().run("UPDATE users SET status = 'kicked' WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
