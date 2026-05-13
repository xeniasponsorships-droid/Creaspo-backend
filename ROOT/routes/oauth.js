const router = require('express').Router();
const { getOne, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

// OAuth routes - connect social platforms
// Full OAuth requires platform credentials in .env

router.get('/connected', requireAuth, async (req, res) => {
  try {
    const rows = await require('../db').getAll('SELECT platform, platform_data, connected_at FROM oauth_tokens WHERE user_id = $1', [req.user.id]);
    res.json(rows.map(r => ({ platform: r.platform, stats: typeof r.platform_data === 'string' ? JSON.parse(r.platform_data) : r.platform_data, connectedAt: r.connected_at })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:platform/disconnect', requireAuth, async (req, res) => {
  try {
    await run('DELETE FROM oauth_tokens WHERE user_id = $1 AND platform = $2', [req.user.id, req.params.platform]);
    const user = await getOne('SELECT profile FROM users WHERE id = $1', [req.user.id]);
    const profile = typeof user?.profile === 'string' ? JSON.parse(user.profile) : (user?.profile || {});
    profile.connectedPlatforms = (profile.connectedPlatforms || []).filter(p => p !== req.params.platform);
    if (profile.liveStats) delete profile.liveStats[req.params.platform];
    await run('UPDATE users SET profile = $1 WHERE id = $2', [JSON.stringify(profile), req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/newsletter', requireAuth, async (req, res) => {
  try {
    const { handle, subscribers, openRate } = req.body;
    if (!handle) return res.status(400).json({ error: 'Handle required' });
    const stats = { handle, followers: subscribers ? `${subscribers} subscribers` : '—', engagement: openRate ? `${openRate}% open rate` : '—', verified: false };
    const user = await getOne('SELECT profile FROM users WHERE id = $1', [req.user.id]);
    const profile = typeof user?.profile === 'string' ? JSON.parse(user.profile) : (user?.profile || {});
    profile.connectedPlatforms = profile.connectedPlatforms || [];
    profile.platforms = profile.platforms || [];
    profile.liveStats = profile.liveStats || {};
    if (!profile.connectedPlatforms.includes('newsletter')) profile.connectedPlatforms.push('newsletter');
    if (!profile.platforms.includes('newsletter')) profile.platforms.push('newsletter');
    profile.liveStats['newsletter'] = { ...stats, connectedAt: Date.now() };
    await run('UPDATE users SET profile = $1 WHERE id = $2', [JSON.stringify(profile), req.user.id]);
    res.json({ success: true, stats });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
