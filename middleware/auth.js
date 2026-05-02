const jwt = require('jsonwebtoken');
const { getDB } = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = getDB().get('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!user || user.status === 'kicked') return res.status(401).json({ error: 'Account not found' });
    user.profile = JSON.parse(user.profile || '{}');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
