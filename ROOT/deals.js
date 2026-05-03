const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const parseDeal = d => d ? { ...d, history: JSON.parse(d.history || '[]'), submission: d.submission ? JSON.parse(d.submission) : null } : null;

function fetchDeals(where, params) {
  return getDB().all(`SELECT * FROM deals WHERE ${where} ORDER BY created_at DESC`, params).map(parseDeal);
}

function stamp(deal, status, entry, extra = {}) {
  const db = getDB();
  const hist = Array.isArray(deal.history) ? deal.history : JSON.parse(deal.history || '[]');
  const history = JSON.stringify([...hist, { at: Date.now(), ...entry }]);
  const sets = ['status = ?', 'history = ?'];
  const vals = [status, history];
  Object.entries(extra).forEach(([k, v]) => { sets.push(`${k} = ?`); vals.push(v); });
  vals.push(deal.id);
  db.run(`UPDATE deals SET ${sets.join(', ')} WHERE id = ?`, vals);
  return parseDeal(db.get('SELECT * FROM deals WHERE id = ?', [deal.id]));
}

router.get('/', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.json(getDB().all('SELECT * FROM deals ORDER BY created_at DESC').map(parseDeal));
  if (req.user.role === 'creator') return res.json(fetchDeals('creator_id = ?', [req.user.id]));
  res.json(fetchDeals('sponsor_id = ?', [req.user.id]));
});

router.get('/inbox', requireAuth, (req, res) => {
  if (req.user.role === 'creator') return res.json(fetchDeals("creator_id = ? AND status IN ('pending','counter')", [req.user.id]));
  res.json(fetchDeals("sponsor_id = ? AND status = 'creator_counter'", [req.user.id]));
});

router.get('/active', requireAuth, (req, res) => {
  if (req.user.role === 'creator') return res.json(fetchDeals("creator_id = ? AND status IN ('active','changes','review')", [req.user.id]));
  res.json(fetchDeals("sponsor_id = ? AND status IN ('active','changes','review')", [req.user.id]));
});

router.get('/completed', requireAuth, (req, res) => {
  if (req.user.role === 'creator') return res.json(fetchDeals("creator_id = ? AND status IN ('paid','declined')", [req.user.id]));
  res.json(fetchDeals("sponsor_id = ? AND status IN ('paid','declined')", [req.user.id]));
});

router.get('/:id', requireAuth, (req, res) => {
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && deal.creator_id !== req.user.id && deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  res.json(deal);
});

router.post('/', requireAuth, requireRole('sponsor'), (req, res) => {
  const { campaignId, creatorIds, price, deliverables, note } = req.body;
  if (!campaignId || !creatorIds?.length) return res.status(400).json({ error: 'campaignId and creatorIds required' });
  const db = getDB();
  const camp = db.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
  if (!camp || camp.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Not your campaign' });
  const created = [];
  creatorIds.forEach(cid => {
    if (db.get('SELECT id FROM deals WHERE campaign_id = ? AND creator_id = ?', [campaignId, cid])) return;
    const id = 'd' + uuid().replace(/-/g, '').slice(0, 12);
    const finalPrice = price || camp.budget;
    db.run(
      'INSERT INTO deals (id,campaign_id,sponsor_id,creator_id,offered_price,price,deliverables,note,deadline,status,history,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, campaignId, req.user.id, cid, finalPrice, finalPrice, deliverables || camp.requirements || '', note || '', camp.deadline || '', 'pending', JSON.stringify([{ at: Date.now(), by: 'sponsor', action: 'offer', price: finalPrice }]), Math.floor(Date.now() / 1000)]
    );
    created.push(parseDeal(db.get('SELECT * FROM deals WHERE id = ?', [id])));
  });
  res.status(201).json(created);
});

router.post('/:id/accept', requireAuth, requireRole('creator'), (req, res) => {
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!['pending', 'counter'].includes(deal.status)) return res.status(400).json({ error: 'Cannot accept now' });
  res.json(stamp(deal, 'active', { by: 'creator', action: 'accepted' }));
});

router.post('/:id/decline', requireAuth, requireRole('creator'), (req, res) => {
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  res.json(stamp(deal, 'declined', { by: 'creator', action: 'declined' }));
});

router.post('/:id/counter', requireAuth, requireRole('creator'), (req, res) => {
  const { price, deliverables, note } = req.body;
  if (!note) return res.status(400).json({ error: 'Note required' });
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const extra = {};
  if (price) extra.price = price;
  if (deliverables) extra.deliverables = deliverables;
  res.json(stamp(deal, 'creator_counter', { by: 'creator', action: 'counter', price, deliverables, note }, extra));
});

router.post('/:id/submit', requireAuth, requireRole('creator'), (req, res) => {
  const { url, notes } = req.body;
  if (!url) return res.status(400).json({ error: 'Content URL required' });
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!['active', 'changes'].includes(deal.status)) return res.status(400).json({ error: 'Cannot submit now' });
  res.json(stamp(deal, 'review', { by: 'creator', action: 'submitted', url }, { submission: JSON.stringify({ url, notes: notes || '', ts: Date.now() }) }));
});

router.post('/:id/sponsor-accept', requireAuth, requireRole('sponsor'), (req, res) => {
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (deal.status !== 'creator_counter') return res.status(400).json({ error: 'No counter to accept' });
  res.json(stamp(deal, 'active', { by: 'sponsor', action: 'accepted counter' }));
});

router.post('/:id/sponsor-decline', requireAuth, requireRole('sponsor'), (req, res) => {
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  res.json(stamp(deal, 'declined', { by: 'sponsor', action: 'declined' }));
});

router.post('/:id/sponsor-counter', requireAuth, requireRole('sponsor'), (req, res) => {
  const { price, deliverables, note } = req.body;
  if (!note) return res.status(400).json({ error: 'Note required' });
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const extra = {};
  if (price) extra.price = price;
  if (deliverables) extra.deliverables = deliverables;
  res.json(stamp(deal, 'counter', { by: 'sponsor', action: 'counter', price, deliverables, note }, extra));
});

router.post('/:id/approve', requireAuth, requireRole('sponsor'), (req, res) => {
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (deal.status !== 'review') return res.status(400).json({ error: 'Nothing to approve' });
  res.json(stamp(deal, 'paid', { by: 'sponsor', action: 'approved and paid' }));
});

router.post('/:id/request-changes', requireAuth, requireRole('sponsor'), (req, res) => {
  const { feedback } = req.body;
  if (!feedback) return res.status(400).json({ error: 'Feedback required' });
  const deal = parseDeal(getDB().get('SELECT * FROM deals WHERE id = ?', [req.params.id]));
  if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const sub = deal.submission ? { ...deal.submission, feedback } : { feedback };
  res.json(stamp(deal, 'changes', { by: 'sponsor', action: 'changes requested', feedback }, { submission: JSON.stringify(sub) }));
});

module.exports = router;
