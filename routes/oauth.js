const router = require('express').Router();
const https = require('https');
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? (typeof body === 'string' ? body : new URLSearchParams(body).toString()) : null;
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Accept': 'application/json', ...headers } };
    if (payload) { opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/x-www-form-urlencoded'; opts.headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = https.request(opts, res => { let data = ''; res.on('data', d => data += d); res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } }); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const get = (url, headers) => request('GET', url, null, headers);
const post = (url, body, headers) => request('POST', url, body, headers);
const fmt = n => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n/1000)}k` : `${n}`;
const pct = n => `${Math.min(100, Math.max(0, n * 100)).toFixed(1)}%`;

const redir = platform => {
  const base = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
  return `${base}/api/oauth/${platform}/callback`;
};

const PLATFORMS = {
  youtube: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/youtube.readonly', cid: () => process.env.GOOGLE_CLIENT_ID, secret: () => process.env.GOOGLE_CLIENT_SECRET, extra: { access_type: 'offline', prompt: 'consent' }, async stats(token) { const r = await get('https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&mine=true', { Authorization: `Bearer ${token}` }); const ch = r?.items?.[0]; if (!ch) return {}; const subs = +ch.statistics.subscriberCount || 0; return { handle: ch.snippet.customUrl || ch.snippet.title, followers: fmt(subs), engagement: '—' }; } },
  instagram: { auth: 'https://api.instagram.com/oauth/authorize', token: 'https://api.instagram.com/oauth/access_token', scope: 'user_profile,user_media', cid: () => process.env.INSTAGRAM_CLIENT_ID, secret: () => process.env.INSTAGRAM_CLIENT_SECRET, async stats(token) { const r = await get(`https://graph.instagram.com/me?fields=username,followers_count&access_token=${token}`); return { handle: `@${r.username||'user'}`, followers: fmt(r.followers_count||0), engagement: '—' }; } },
  tiktok: { auth: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/', scope: 'user.info.basic', cid: () => process.env.TIKTOK_CLIENT_ID, secret: () => process.env.TIKTOK_CLIENT_SECRET, async stats(token) { const r = await get('https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count', { Authorization: `Bearer ${token}` }); const u = r?.data?.user || {}; return { handle: `@${u.display_name||'user'}`, followers: fmt(u.follower_count||0), engagement: '—' }; } },
  twitch: { auth: 'https://id.twitch.tv/oauth2/authorize', token: 'https://id.twitch.tv/oauth2/token', scope: 'user:read:follows', cid: () => process.env.TWITCH_CLIENT_ID, secret: () => process.env.TWITCH_CLIENT_SECRET, async stats(token) { const me = await get('https://api.twitch.tv/helix/users', { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID }); const u = me?.data?.[0]; if (!u) return {}; const fl = await get(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${u.id}`, { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID }); return { handle: `@${u.login}`, followers: fmt(fl?.total||0), engagement: '—' }; } },
  linkedin: { auth: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken', scope: 'r_liteprofile', cid: () => process.env.LINKEDIN_CLIENT_ID, secret: () => process.env.LINKEDIN_CLIENT_SECRET, async stats(token) { const r = await get('https://api.linkedin.com/v2/me', { Authorization: `Bearer ${token}` }); return { handle: [r.localizedFirstName, r.localizedLastName].filter(Boolean).join(' ') || 'LinkedIn', followers: '—', engagement: '—' }; } },
  x: { auth: 'https://twitter.com/i/oauth2/authorize', token: 'https://api.twitter.com/2/oauth2/token', scope: 'tweet.read users.read offline.access', cid: () => process.env.X_CLIENT_ID, secret: () => process.env.X_CLIENT_SECRET, extra: { code_challenge: 'challenge', code_challenge_method: 'plain' }, async stats(token) { const r = await get('https://api.twitter.com/2/users/me?user.fields=public_metrics,username', { Authorization: `Bearer ${token}` }); const m = r?.data?.public_metrics || {}; return { handle: `@${r?.data?.username||'user'}`, followers: fmt(m.followers_count||0), engagement: '—' }; } },
  facebook: { auth: 'https://www.facebook.com/v18.0/dialog/oauth', token: 'https://graph.facebook.com/v18.0/oauth/access_token', scope: 'public_profile', cid: () => process.env.FACEBOOK_CLIENT_ID, secret: () => process.env.FACEBOOK_CLIENT_SECRET, async stats(token) { const r = await get(`https://graph.facebook.com/me?fields=name,fan_count&access_token=${token}`); return { handle: r.name||'Page', followers: fmt(r.fan_count||0), engagement: '—' }; } },
  snapchat: { auth: 'https://accounts.snapchat.com/accounts/oauth2/auth', token: 'https://accounts.snapchat.com/accounts/oauth2/token', scope: 'snapchat-marketing-api', cid: () => process.env.SNAPCHAT_CLIENT_ID, secret: () => process.env.SNAPCHAT_CLIENT_SECRET, async stats() { return { handle: '@creator', followers: '—', engagement: '—' }; } },
  pinterest: { auth: 'https://www.pinterest.com/oauth/', token: 'https://api.pinterest.com/v5/oauth/token', scope: 'user_accounts:read', cid: () => process.env.PINTEREST_CLIENT_ID, secret: () => process.env.PINTEREST_CLIENT_SECRET, async stats(token) { const r = await get('https://api.pinterest.com/v5/user_account', { Authorization: `Bearer ${token}` }); return { handle: `@${r.username||'user'}`, followers: fmt(r.follower_count||0), engagement: '—' }; } },
  reddit: { auth: 'https://www.reddit.com/api/v1/authorize', token: 'https://www.reddit.com/api/v1/access_token', scope: 'identity', cid: () => process.env.REDDIT_CLIENT_ID, secret: () => process.env.REDDIT_CLIENT_SECRET, async stats(token) { const r = await get('https://oauth.reddit.com/api/v1/me', { Authorization: `Bearer ${token}`, 'User-Agent': 'Creaspo/1.0' }); return { handle: `u/${r.name||'user'}`, followers: fmt((r.link_karma||0)+(r.comment_karma||0)) + ' karma', engagement: '—' }; } },
  spotify: { auth: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token', scope: 'user-read-private', cid: () => process.env.SPOTIFY_CLIENT_ID, secret: () => process.env.SPOTIFY_CLIENT_SECRET, async stats(token) { const r = await get('https://api.spotify.com/v1/me', { Authorization: `Bearer ${token}` }); return { handle: r.display_name||'Spotify', followers: fmt(r.followers?.total||0), engagement: '—' }; } },
};

const states = new Map();

router.get('/:platform/connect', requireAuth, (req, res) => {
  const cfg = PLATFORMS[req.params.platform];
  if (!cfg) return res.status(404).json({ error: 'Unknown platform' });
  if (!cfg.cid()) return res.status(503).json({ error: `${req.params.platform} credentials not configured` });
  const state = uuid();
  states.set(state, { userId: req.user.id, platform: req.params.platform });
  setTimeout(() => states.delete(state), 10 * 60 * 1000);
  const params = new URLSearchParams({ client_id: cfg.cid(), redirect_uri: redir(req.params.platform), response_type: 'code', scope: cfg.scope, state, ...(cfg.extra || {}) });
  res.redirect(`${cfg.auth}?${params}`);
});

router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const { code, state, error } = req.query;
  const fe = process.env.FRONTEND_URL || 'http://localhost:5500';
  if (error) return res.redirect(`${fe}?oauth_error=${encodeURIComponent(error)}&platform=${platform}`);
  const cfg = PLATFORMS[platform];
  if (!cfg) return res.status(404).send('Unknown platform');
  const stateData = states.get(state);
  if (!stateData) return res.status(400).send('Expired state. Please try again.');
  states.delete(state);
  try {
    const tokenRes = await post(cfg.token, { client_id: cfg.cid(), client_secret: cfg.secret(), code, grant_type: 'authorization_code', redirect_uri: redir(platform) });
    if (!tokenRes.access_token) return res.redirect(`${fe}?oauth_error=token_failed&platform=${platform}`);
    let stats = { handle: '', followers: '—', engagement: '—', verified: true };
    try { stats = { ...(await cfg.stats(tokenRes.access_token)), verified: true }; } catch (e) { console.warn(`[oauth] ${platform} stats error:`, e.message); }
    const db = getDB();
    db.run(`INSERT INTO oauth_tokens (id,user_id,platform,access_token,refresh_token,expires_at,platform_data,connected_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,platform) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, platform_data=excluded.platform_data, connected_at=excluded.connected_at`,
      [uuid(), stateData.userId, platform, tokenRes.access_token, tokenRes.refresh_token || null, tokenRes.expires_in ? Math.floor(Date.now() / 1000) + tokenRes.expires_in : null, JSON.stringify(stats), Math.floor(Date.now() / 1000)]);
    const user = db.get('SELECT profile FROM users WHERE id = ?', [stateData.userId]);
    const profile = JSON.parse(user?.profile || '{}');
    profile.connectedPlatforms = profile.connectedPlatforms || [];
    profile.platforms = profile.platforms || [];
    profile.liveStats = profile.liveStats || {};
    if (!profile.connectedPlatforms.includes(platform)) profile.connectedPlatforms.push(platform);
    if (!profile.platforms.includes(platform)) profile.platforms.push(platform);
    profile.liveStats[platform] = { ...stats, connectedAt: Date.now() };
    db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify(profile), stateData.userId]);
    res.redirect(`${fe}?oauth_success=${platform}`);
  } catch (e) {
    console.error(`[oauth] ${platform} callback error:`, e.message);
    res.redirect(`${fe}?oauth_error=server_error&platform=${platform}`);
  }
});

router.post('/:platform/disconnect', requireAuth, (req, res) => {
  const db = getDB();
  db.run('DELETE FROM oauth_tokens WHERE user_id = ? AND platform = ?', [req.user.id, req.params.platform]);
  const user = db.get('SELECT profile FROM users WHERE id = ?', [req.user.id]);
  const profile = JSON.parse(user?.profile || '{}');
  profile.connectedPlatforms = (profile.connectedPlatforms || []).filter(p => p !== req.params.platform);
  if (profile.liveStats) delete profile.liveStats[req.params.platform];
  db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify(profile), req.user.id]);
  res.json({ success: true });
});

router.get('/connected', requireAuth, (req, res) => {
  const rows = getDB().all('SELECT platform, platform_data, connected_at FROM oauth_tokens WHERE user_id = ?', [req.user.id]);
  res.json(rows.map(r => ({ platform: r.platform, stats: JSON.parse(r.platform_data || '{}'), connectedAt: r.connected_at })));
});

router.post('/newsletter', requireAuth, (req, res) => {
  const { handle, subscribers, openRate } = req.body;
  if (!handle) return res.status(400).json({ error: 'Handle required' });
  const stats = { handle, followers: subscribers ? `${subscribers} subscribers` : '—', engagement: openRate ? `${openRate}% open rate` : '—', verified: false };
  const db = getDB();
  const user = db.get('SELECT profile FROM users WHERE id = ?', [req.user.id]);
  const profile = JSON.parse(user?.profile || '{}');
  profile.connectedPlatforms = profile.connectedPlatforms || [];
  profile.platforms = profile.platforms || [];
  profile.liveStats = profile.liveStats || {};
  if (!profile.connectedPlatforms.includes('newsletter')) profile.connectedPlatforms.push('newsletter');
  if (!profile.platforms.includes('newsletter')) profile.platforms.push('newsletter');
  profile.liveStats['newsletter'] = { ...stats, connectedAt: Date.now() };
  db.run('UPDATE users SET profile = ? WHERE id = ?', [JSON.stringify(profile), req.user.id]);
  res.json({ success: true, stats });
});

module.exports = router;
