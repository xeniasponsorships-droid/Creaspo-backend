const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  if (req.user.role === 'admin') return res.json(db.all('SELECT * FROM applications ORDER BY created_at DESC'));
  if (req.user.role === 'sponsor') return res.json(db.all('SELECT * FROM applications WHERE sponsor_id = ? ORDER BY created_at DESC', [req.user.id]));
  res.json(db.all('SELECT * FROM applications WHERE creator_id = ? ORDER BY created_at DESC', [req.user.id]));
});

router.post('/', requireAuth, requireRole('creator'), (req, res) => {
  const { campaignId, message, rate, deliverables } = req.body;
  if (!campaignId || !message || !rate) return res.status(400).json({ error: 'campaignId, message and rate required' });
  const db = getDB();
  const camp = db.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
  if (!camp) return res.status(404).json({ error: 'Campaign not found' });
  if (camp.status !== 'active') return res.status(400).json({ error: 'Campaign is closed' });
  if (db.get('SELECT id FROM applications WHERE campaign_id = ? AND creator_id = ?', [campaignId, req.user.id])) {
    return res.status(409).json({ error: 'Already applied' });
  }
  const id = 'app' + uuid().replace(/-/g, '').slice(0, 10);
  db.run(
    'INSERT INTO applications (id,campaign_id,creator_id,sponsor_id,message,rate,deliverables,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, campaignId, req.user.id, camp.sponsor_id, message, rate, deliverables || camp.requirements || '', 'pending', Math.floor(Date.now() / 1000)]
  );
  res.status(201).json(db.get('SELECT * FROM applications WHERE id = ?', [id]));
});

router.post('/:id/accept', requireAuth, requireRole('sponsor'), (req, res) => {
  const db = getDB();
  const app = db.get('SELECT * FROM applications WHERE id = ?', [req.params.id]);
  if (!app || app.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (app.status !== 'pending') return res.status(400).json({ error: 'Already handled' });
  db.run("UPDATE applications SET status = 'accepted' WHERE id = ?", [app.id]);
  const camp = db.get('SELECT * FROM campaigns WHERE id = ?', [app.campaign_id]);
  const dealId = 'd' + uuid().replace(/-/g, '').slice(0, 12);
  db.run(
    'INSERT INTO deals (id,campaign_id,sponsor_id,creator_id,offered_price,price,deliverables,note,deadline,status,history,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [dealId, app.campaign_id, req.user.id, app.creator_id, app.rate, app.rate, app.deliverables || camp?.requirements || '', 'Application accepted.', camp?.deadline || '', 'active', JSON.stringify([{ at: Date.now(), by: 'sponsor', action: 'accepted application' }]), Math.floor(Date.now() / 1000)]
  );
  res.json({ application: db.get('SELECT * FROM applications WHERE id = ?', [app.id]), deal: db.get('SELECT * FROM deals WHERE id = ?', [dealId]) });
});

router.post('/:id/decline', requireAuth, requireRole('sponsor'), (req, res) => {
  const db = getDB();
  const app = db.get('SELECT * FROM applications WHERE id = ?', [req.params.id]);
  if (!app || app.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.run("UPDATE applications SET status = 'declined' WHERE id = ?", [app.id]);
  res.json(db.get('SELECT * FROM applications WHERE id = ?', [app.id]));
});

router.post('/:id/counter', requireAuth, requireRole('sponsor'), (req, res) => {
  const { price, deliverables, note } = req.body;
  if (!note) return res.status(400).json({ error: 'Note required' });
  const db = getDB();
  const app = db.get('SELECT * FROM applications WHERE id = ?', [req.params.id]);
  if (!app || app.sponsor_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.run("UPDATE applications SET status = 'declined' WHERE id = ?", [app.id]);
  const camp = db.get('SELECT * FROM campaigns WHERE id = ?', [app.campaign_id]);
  const dealId = 'd' + uuid().replace(/-/g, '').slice(0, 12);
  const finalPrice = price || app.rate;
  const finalDel = deliverables || app.deliverables || camp?.requirements || '';
  db.run(
    'INSERT INTO deals (id,campaign_id,sponsor_id,creator_id,offered_price,price,deliverables,note,deadline,status,history,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [dealId, app.campaign_id, req.user.id, app.creator_id, finalPrice, finalPrice, finalDel, note, camp?.deadline || '', 'counter', JSON.stringify([{ at: Date.now(), by: 'sponsor', action: 'counter', price: finalPrice, deliverables: finalDel, note }]), Math.floor(Date.now() / 1000)]
  );
  res.status(201).json(db.get('SELECT * FROM deals WHERE id = ?', [dealId]));
});

module.exports = router;
