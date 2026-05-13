const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getOne, getAll, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

function genCode() {
  return 'CREASPO-' + Math.random().toString(36).toUpperCase().slice(2, 8);
}

router.post('/request', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const { link, platform } = req.body;
    if (!link || !platform) return res.status(400).json({ error: 'Link and platform required' });
    const user = await getOne('SELECT profile FROM users WHERE id = $1', [req.user.id]);
    const profile = typeof user?.profile === 'string' ? JSON.parse(user.profile) : (user?.profile || {});
    if (profile.verified) return res.status(400).json({ error: 'Already verified' });
    await run("DELETE FROM verify_requests WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
    const code = genCode();
    const id = 'vr' + uuid().replace(/-/g, '').slice(0, 10);
    await run('INSERT INTO verify_requests (id, user_id, platform, link, code, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, req.user.id, platform, link, code, 'pending', Math.floor(Date.now() / 1000)]);
    profile.verifyStatus = 'pending';
    await run('UPDATE users SET profile = $1 WHERE id = $2', [JSON.stringify(profile), req.user.id]);
    res.json({ code, id });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/confirm', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const vr = await getOne("SELECT * FROM verify_requests WHERE user_id = $1 AND status = 'pending'", [req.user.id]);
    if (!vr) return res.status(404).json({ error: 'No pending request' });
    await run("UPDATE verify_requests SET status = 'submitted' WHERE id = $1", [vr.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/pending', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const reqs = await getAll("SELECT * FROM verify_requests WHERE status = 'submitted' ORDER BY created_at ASC");
    res.json(reqs.map(r => ({ ...r, userId: r.user_id })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const vr = await getOne('SELECT * FROM verify_requests WHERE id = $1', [req.params.id]);
    if (!vr) return res.status(404).json({ error: 'Not found' });
    await run("UPDATE verify_requests SET status = 'approved' WHERE id = $1", [vr.id]);
    const user = await getOne('SELECT profile FROM users WHERE id = $1', [vr.user_id]);
    const profile = typeof user?.profile === 'string' ? JSON.parse(user.profile) : (user?.profile || {});
    profile.verified = true;
    profile.verifyStatus = 'approved';
    profile.verifiedPlatform = vr.platform;
    profile.verifiedLink = vr.link;
    await run('UPDATE users SET profile = $1 WHERE id = $2', [JSON.stringify(profile), vr.user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/reject', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const vr = await getOne('SELECT * FROM verify_requests WHERE id = $1', [req.params.id]);
    if (!vr) return res.status(404).json({ error: 'Not found' });
    await run("UPDATE verify_requests SET status = 'rejected' WHERE id = $1", [vr.id]);
    const user = await getOne('SELECT profile FROM users WHERE id = $1', [vr.user_id]);
    const profile = typeof user?.profile === 'string' ? JSON.parse(user.profile) : (user?.profile || {});
    profile.verifyStatus = 'rejected';
    await run('UPDATE users SET profile = $1 WHERE id = $2', [JSON.stringify(profile), vr.user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
