const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { getOne, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

const sign = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const safe = u => { const { password, ...r } = u; r.profile = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile; return r; };

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await getOne('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Wrong email or password' });
    if (user.status === 'kicked') return res.status(401).json({ error: 'Account removed' });
    if (user.role === 'admin' && user.email !== 'admin@creaspo.io') return res.status(401).json({ error: 'Wrong email or password' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Wrong email or password' });
    res.json({ token: sign(user.id), user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!firstName || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
    if (!['creator', 'sponsor'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const exists = await getOne('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const id = 'u' + uuid().replace(/-/g, '').slice(0, 12);
    const profile = JSON.stringify({ platforms: [], connectedPlatforms: [], liveStats: {} });
    await run(
      'INSERT INTO users (id,email,password,role,name,status,joined_at,profile) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, `${firstName} ${lastName || ''}`.trim(), 'active', Math.floor(Date.now() / 1000), profile]
    );
    const user = await getOne('SELECT * FROM users WHERE id = $1', [id]);
    res.status(201).json({ token: sign(id), user: safe(user) });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.get('/me', requireAuth, (req, res) => {
  const { password, ...user } = req.user;
  res.json({ user });
});

module.exports = router;
