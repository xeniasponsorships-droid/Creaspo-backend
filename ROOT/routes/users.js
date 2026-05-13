const router = require('express').Router();
const { getOne, getAll, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const safe = u => { if (!u) return u; const { password, ...r } = u; r.profile = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile; return r; };

router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') rows = await getAll("SELECT * FROM users WHERE role != 'admin'");
    else if (req.user.role === 'sponsor') rows = await getAll("SELECT * FROM users WHERE role = 'creator' AND status = 'active'");
    else rows = await getAll("SELECT * FROM users WHERE role = 'sponsor' AND status = 'active'");
    res.json(rows.map(safe));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const user = await getOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(safe(user));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/me/profile', requireAuth, async (req, res) => {
  try {
    const { name, profile } = req.body;
    const current = await getOne('SELECT profile FROM users WHERE id = $1', [req.user.id]);
    const currentProfile = typeof current.profile === 'string' ? JSON.parse(current.profile) : current.profile;
    const merged = { ...currentProfile, ...(profile || {}) };
    await run('UPDATE users SET profile = $1, name = $2 WHERE id = $3', [JSON.stringify(merged), name || req.user.name, req.user.id]);
    const updated = await getOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json(safe(updated));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/kick', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const user = await getOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot remove admin' });
    await run("UPDATE users SET status = 'kicked' WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
