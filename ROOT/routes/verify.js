const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
 
// Generate a unique verification code
function genCode() {
  return 'CREASPO-' + Math.random().toString(36).toUpperCase().slice(2, 8);
}
 
// POST /api/verify/request — creator requests verification
router.post('/request', requireAuth, requireRole('creator'), (req, res) => {
  const { link, platform } = req.body;
  if (!link || !platform) return res.status(400).json({ error: 'Link and platform required' });
  const db = getDB();
 
  // Check if already verified
  const user = db.get('SELECT profile FROM users WHERE id = ?', [req.user.id]);
  const profile = JSON.parse(user?.profile || '{}');
  if (profile.verified) return res.status(400).json({ error: 'Already verified' });
 
  // Delete any existing pending request
  db.run("DELETE FROM verify_requests WHERE user_id = ? AND status = 'pending'", [req.user.id]);
 
  const code = genCode();
  const id = 'vr' + uuid().replace(/-/g, '').slice(0, 10);
  db.run(
    'INSERT INTO verify_requests (id, user_id, platform, link, code, status, created_at) VALUES (?,?,?,?,?,?,?)',
    [id, req.user.id, platform, link, code, 'pending', Math.floor(Date.now() / 1000)]
  );
 
  // Save pending status to profile
  profile.verifyStatus = 'pending';
  db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify(profile), req.user.id]);
 
  res.json({ code, id });
});
 
// POST /api/verify/confirm — creator confirms they added the code
router.post('/confirm', requireAuth, requireRole('creator'), (req, res) => {
  const db = getDB();
  const req2 = db.get("SELECT * FROM verify_requests WHERE user_id = ? AND status = 'pending'", [req.user.id]);
  if (!req2) return res.status(404).json({ error: 'No pending verification request found' });
  db.run("UPDATE verify_requests SET status = 'submitted' WHERE id = ?", [req2.id]);
  res.json({ success: true });
});
 
// GET /api/verify/pending — admin sees all pending verifications
router.get('/pending', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDB();
  const reqs = db.all("SELECT * FROM verify_requests WHERE status = 'submitted' ORDER BY created_at ASC");
  res.json(reqs.map(r => ({ ...r, userId: r.user_id })));
});
 
// POST /api/verify/:id/approve — admin approves
router.post('/:id/approve', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDB();
  const vr = db.get('SELECT * FROM verify_requests WHERE id = ?', [req.params.id]);
  if (!vr) return res.status(404).json({ error: 'Not found' });
  db.run("UPDATE verify_requests SET status = 'approved' WHERE id = ?", [vr.id]);
 
  // Update user profile — add verified badge
  const user = db.get('SELECT profile FROM users WHERE id = ?', [vr.user_id]);
  const profile = JSON.parse(user?.profile || '{}');
  profile.verified = true;
  profile.verifyStatus = 'approved';
  profile.verifiedPlatform = vr.platform;
  profile.verifiedLink = vr.link;
  db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify(profile), vr.user_id]);
 
  res.json({ success: true });
});
 
// POST /api/verify/:id/reject — admin rejects
router.post('/:id/reject', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDB();
  const vr = db.get('SELECT * FROM verify_requests WHERE id = ?', [req.params.id]);
  if (!vr) return res.status(404).json({ error: 'Not found' });
  db.run("UPDATE verify_requests SET status = 'rejected' WHERE id = ?", [vr.id]);
 
  // Reset verify status on profile
  const user = db.get('SELECT profile FROM users WHERE id = ?', [vr.user_id]);
  const profile = JSON.parse(user?.profile || '{}');
  profile.verifyStatus = 'rejected';
  db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify(profile), vr.user_id]);
 
  res.json({ success: true });
});
 
module.exports = router;
