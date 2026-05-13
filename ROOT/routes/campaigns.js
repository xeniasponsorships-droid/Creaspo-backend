const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getOne, getAll, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try { res.json(await getAll("SELECT * FROM campaigns WHERE status = 'active' ORDER BY created_at DESC")); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/mine', requireAuth, requireRole('sponsor', 'admin'), async (req, res) => {
  try {
    const rows = req.user.role === 'admin'
      ? await getAll('SELECT * FROM campaigns ORDER BY created_at DESC')
      : await getAll('SELECT * FROM campaigns WHERE sponsor_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const c = await getOne('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const { title, description, budget, numCreators, requirements, deadline, niche } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = 'c' + uuid().replace(/-/g, '').slice(0, 12);
    await run(
      'INSERT INTO campaigns (id,sponsor_id,title,description,budget,num_creators,requirements,deadline,niche,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, req.user.id, title, description || '', budget || 'TBD', parseInt(numCreators) || 1, requirements || '', deadline || '', niche || '', 'active', Math.floor(Date.now() / 1000)]
    );
    res.status(201).json(await getOne('SELECT * FROM campaigns WHERE id = $1', [id]));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id', requireAuth, requireRole('sponsor', 'admin'), async (req, res) => {
  try {
    const camp = await getOne('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    if (!camp) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && camp.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const allowed = ['title','description','budget','num_creators','requirements','deadline','niche','status'];
    const sets = []; const vals = [];
    allowed.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = $${sets.length + 1}`); vals.push(req.body[f]); } });
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await run(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    res.json(await getOne('SELECT * FROM campaigns WHERE id = $1', [req.params.id]));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
