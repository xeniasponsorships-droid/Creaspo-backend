const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

const sign = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const safe = u => { const { password, ...r } = u; r.profile = typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile; return r; };

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  if (!user) return res.status(401).json({ error: 'Wrong email or password' });
  if (user.status === 'kicked') return res.status(401).json({ error: 'Account removed' });
  if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: sign(user.id), user: safe(user) });
});

router.post('/register', (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;
  if (!firstName || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
  if (!['creator', 'sponsor'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const db = getDB();
  if (db.get('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()])) return res.status(409).json({ error: 'Email already registered' });
  const id = 'u' + uuid().replace(/-/g, '').slice(0, 12);
  const profile = JSON.stringify({ platforms: [], connectedPlatforms: [], liveStats: {} });
  db.run(
    'INSERT INTO users (id,email,password,role,name,status,joined_at,profile) VALUES (?,?,?,?,?,?,?,?)',
    [id, email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, `${firstName} ${lastName || ''}`.trim(), 'active', Math.floor(Date.now() / 1000), profile]
  );
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  res.status(201).json({ token: sign(id), user: safe(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: safe(req.user) }));

module.exports = router;
