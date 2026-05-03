const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.json(getDB().all("SELECT * FROM campaigns WHERE status = 'active' ORDER BY created_at DESC"));
});

router.get('/mine', requireAuth, requireRole('sponsor', 'admin'), (req, res) => {
  const db = getDB();
  res.json(req.user.role === 'admin'
    ? db.all('SELECT * FROM campaigns ORDER BY created_at DESC')
    : db.all('SELECT * FROM campaigns WHERE sponsor_id = ? ORDER BY created_at DESC', [req.user.id]));
});

router.get('/:id', requireAuth, (req, res) => {
  const c = getDB().get('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

router.post('/', requireAuth, requireRole('sponsor'), (req, res) => {
  const { title, description, budget, numCreators, requirements, deadline, niche } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const id = 'c' + uuid().replace(/-/g, '').slice(0, 12);
  const db = getDB();
  db.run(
    'INSERT INTO campaigns (id,sponsor_id,title,description,budget,num_creators,requirements,deadline,niche,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.user.id, title, description || '', budget || 'TBD', parseInt(numCreators) || 1, requirements || '', deadline || '', niche || '', 'active', Math.floor(Date.now() / 1000)]
  );
  res.status(201).json(db.get('SELECT * FROM campaigns WHERE id = ?', [id]));
});

router.patch('/:id', requireAuth, requireRole('sponsor', 'admin'), (req, res) => {
  const db = getDB();
  const camp = db.get('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  if (!camp) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && camp.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const allowed = ['title','description','budget','num_creators','requirements','deadline','niche','status'];
  const sets = []; const vals = [];
  allowed.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); } });
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.run(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`, vals);
  res.json(db.get('SELECT * FROM campaigns WHERE id = ?', [req.params.id]));
});

module.exports = router;
