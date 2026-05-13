const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getOne, getAll, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') rows = await getAll('SELECT * FROM applications ORDER BY created_at DESC');
    else if (req.user.role === 'sponsor') rows = await getAll('SELECT * FROM applications WHERE sponsor_id = $1 ORDER BY created_at DESC', [req.user.id]);
    else rows = await getAll('SELECT * FROM applications WHERE creator_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const { campaignId, message, rate, deliverables } = req.body;
    if (!campaignId || !message || !rate) return res.status(400).json({ error: 'campaignId, message and rate required' });
    const camp = await getOne('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
    if (!camp) return res.status(404).json({ error: 'Campaign not found' });
    if (camp.status !== 'active') return res.status(400).json({ error: 'Campaign is closed' });
    const existing = await getOne('SELECT id FROM applications WHERE campaign_id = $1 AND creator_id = $2', [campaignId, req.user.id]);
    if (existing) return res.status(409).json({ error: 'Already applied' });
    const id = 'app' + uuid().replace(/-/g, '').slice(0, 10);
    await run(
      'INSERT INTO applications (id,campaign_id,creator_id,sponsor_id,message,rate,deliverables,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, campaignId, req.user.id, camp.sponsor_id, message, rate, deliverables || camp.requirements || '', 'pending', Math.floor(Date.now() / 1000)]
    );
    res.status(201).json(await getOne('SELECT * FROM applications WHERE id = $1', [id]));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/accept', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const app = await getOne('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!app || app.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (app.status !== 'pending') return res.status(400).json({ error: 'Already handled' });
    await run("UPDATE applications SET status = 'accepted' WHERE id = $1", [app.id]);
    const camp = await getOne('SELECT * FROM campaigns WHERE id = $1', [app.campaign_id]);
    const dealId = 'd' + uuid().replace(/-/g, '').slice(0, 12);
    await run(
      'INSERT INTO deals (id,campaign_id,sponsor_id,creator_id,offered_price,price,deliverables,note,deadline,status,history,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [dealId, app.campaign_id, req.user.id, app.creator_id, app.rate, app.rate, app.deliverables || camp?.requirements || '', 'Application accepted.', camp?.deadline || '', 'active', JSON.stringify([{ at: Date.now(), by: 'sponsor', action: 'accepted application' }]), Math.floor(Date.now() / 1000)]
    );
    res.json({ application: await getOne('SELECT * FROM applications WHERE id = $1', [app.id]), deal: await getOne('SELECT * FROM deals WHERE id = $1', [dealId]) });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/decline', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const app = await getOne('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!app || app.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await run("UPDATE applications SET status = 'declined' WHERE id = $1", [app.id]);
    res.json(await getOne('SELECT * FROM applications WHERE id = $1', [app.id]));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/counter', requireAuth, requireRole('sponsor'), async (req, res) => {
  try {
    const { price, deliverables, note } = req.body;
    if (!note) return res.status(400).json({ error: 'Note required' });
    const app = await getOne('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    if (!app || app.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    await run("UPDATE applications SET status = 'declined' WHERE id = $1", [app.id]);
    const camp = await getOne('SELECT * FROM campaigns WHERE id = $1', [app.campaign_id]);
    const dealId = 'd' + uuid().replace(/-/g, '').slice(0, 12);
    const finalPrice = price || app.rate;
    const finalDel = deliverables || app.deliverables || camp?.requirements || '';
    await run(
      'INSERT INTO deals (id,campaign_id,sponsor_id,creator_id,offered_price,price,deliverables,note,deadline,status,history,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [dealId, app.campaign_id, req.user.id, app.creator_id, finalPrice, finalPrice, finalDel, note, camp?.deadline || '', 'counter', JSON.stringify([{ at: Date.now(), by: 'sponsor', action: 'counter', price: finalPrice, note }]), Math.floor(Date.now() / 1000)]
    );
    res.status(201).json(await getOne('SELECT * FROM deals WHERE id = $1', [dealId]));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
