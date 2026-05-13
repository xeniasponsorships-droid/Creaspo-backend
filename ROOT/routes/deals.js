const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getOne, getAll, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const parseDeal = d => d ? { ...d, history: typeof d.history === 'string' ? JSON.parse(d.history || '[]') : (d.history || []), submission: d.submission ? (typeof d.submission === 'string' ? JSON.parse(d.submission) : d.submission) : null } : null;

async function stamp(deal, status, entry, extra = {}) {
  const hist = Array.isArray(deal.history) ? deal.history : JSON.parse(deal.history || '[]');
  const history = JSON.stringify([...hist, { at: Date.now(), ...entry }]);
  const sets = ['status = $1', 'history = $2'];
  const vals = [status, history];
  let i = 3;
  Object.entries(extra).forEach(([k, v]) => { sets.push(`${k} = $${i++}`); vals.push(v); });
  vals.push(deal.id);
  await run(`UPDATE deals SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  return parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [deal.id]));
}

router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') rows = await getAll('SELECT * FROM deals ORDER BY created_at DESC');
    else if (req.user.role === 'creator') rows = await getAll('SELECT * FROM deals WHERE creator_id = $1 ORDER BY created_at DESC', [req.user.id]);
    else rows = await getAll('SELECT * FROM deals WHERE sponsor_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows.map(parseDeal));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/inbox', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'creator') rows = await getAll("SELECT * FROM deals WHERE creator_id = $1 AND status IN ('pending','counter') ORDER BY created_at DESC", [req.user.id]);
    else rows = await getAll("SELECT * FROM deals WHERE sponsor_id = $1 AND status = 'creator_counter' ORDER BY created_at DESC", [req.user.id]);
    res.json(rows.map(parseDeal));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/active', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'creator') rows = await getAll("SELECT * FROM deals WHERE creator_id = $1 AND status IN ('active','changes','review') ORDER BY created_at DESC", [req.user.id]);
    else rows = await getAll("SELECT * FROM deals WHERE sponsor_id = $1 AND status IN ('active','changes','review') ORDER BY created_at DESC", [req.user.id]);
    res.json(rows.map(parseDeal));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/completed', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'creator') rows = await getAll("SELECT * FROM deals WHERE creator_id = $1 AND status IN ('paid','declined') ORDER BY created_at DESC", [req.user.id]);
    else rows = await getAll("SELECT * FROM deals WHERE sponsor_id = $1 AND status IN ('paid','declined') ORDER BY created_at DESC", [req.user.id]);
    res.json(rows.map(parseDeal));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && deal.creator_id !== req.user.id && deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(deal);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const { campaignId, creatorIds, price, deliverables, note } = req.body;
    if (!campaignId || !creatorIds?.length) return res.status(400).json({ error: 'campaignId and creatorIds required' });
    const camp = await getOne('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    if (!camp || camp.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Not your campaign' });
    const created = [];
    for (const cid of creatorIds) {
      const existing = await getOne('SELECT id FROM deals WHERE campaign_id = $1 AND creator_id = $2', [campaignId, cid]);
      if (existing) continue;
      const id = 'd' + uuid().replace(/-/g, '').slice(0, 12);
      const finalPrice = price || camp.budget;
      await run(
        'INSERT INTO deals (id,campaign_id,sponsor_id,creator_id,offered_price,price,deliverables,note,deadline,status,history,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [id, campaignId, req.user.id, cid, finalPrice, finalPrice, deliverables || camp.requirements || '', note || '', camp.deadline || '', 'pending', JSON.stringify([{ at: Date.now(), by: 'sponsor', action: 'offer', price: finalPrice }]), Math.floor(Date.now() / 1000)]
      );
      created.push(parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [id])));
    }
    res.status(201).json(created);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/accept', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!['pending', 'counter'].includes(deal.status)) return res.status(400).json({ error: 'Cannot accept now' });
    res.json(await stamp(deal, 'active', { by: 'creator', action: 'accepted' }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/decline', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await stamp(deal, 'declined', { by: 'creator', action: 'declined' }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/counter', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const { price, deliverables, note } = req.body;
    if (!note) return res.status(400).json({ error: 'Note required' });
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const extra = {};
    if (price) extra.price = price;
    if (deliverables) extra.deliverables = deliverables;
    res.json(await stamp(deal, 'creator_counter', { by: 'creator', action: 'counter', price, note }, extra));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/submit', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const { url, notes } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!['active', 'changes'].includes(deal.status)) return res.status(400).json({ error: 'Cannot submit now' });
    res.json(await stamp(deal, 'review', { by: 'creator', action: 'submitted', url }, { submission: JSON.stringify({ url, notes: notes || '', ts: Date.now() }) }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/sponsor-accept', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await stamp(deal, 'active', { by: 'sponsor', action: 'accepted counter' }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/sponsor-decline', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json(await stamp(deal, 'declined', { by: 'sponsor', action: 'declined' }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/sponsor-counter', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const { price, deliverables, note } = req.body;
    if (!note) return res.status(400).json({ error: 'Note required' });
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const extra = {};
    if (price) extra.price = price;
    if (deliverables) extra.deliverables = deliverables;
    res.json(await stamp(deal, 'counter', { by: 'sponsor', action: 'counter', price, note }, extra));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/approve', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (deal.status !== 'review') return res.status(400).json({ error: 'Nothing to approve' });
    res.json(await stamp(deal, 'paid', { by: 'sponsor', action: 'approved and paid' }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/request-changes', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const { feedback } = req.body;
    if (!feedback) return res.status(400).json({ error: 'Feedback required' });
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal || deal.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const sub = deal.submission ? { ...deal.submission, feedback } : { feedback };
    res.json(await stamp(deal, 'changes', { by: 'sponsor', action: 'changes requested', feedback }, { submission: JSON.stringify(sub) }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const deal = parseDeal(await getOne('SELECT * FROM deals WHERE id = $1', [req.params.id]));
    if (!deal) return res.status(404).json({ error: 'Not found' });
    if (deal.sponsor_id !== req.user.id && deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (!['active','changes','review'].includes(deal.status)) return res.status(400).json({ error: 'Cannot complete now' });
    res.json(await stamp(deal, 'paid', { by: req.user.role, action: 'marked completed' }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
