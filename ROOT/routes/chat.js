const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');
 
// GET /api/chat/:dealId — get messages for a deal
router.get('/:dealId', requireAuth, (req, res) => {
  const db = getDB();
  const deal = db.get('SELECT * FROM deals WHERE id = ?', [req.params.dealId]);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.sponsor_id !== req.user.id && deal.creator_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const msgs = db.all('SELECT * FROM chat_messages WHERE deal_id = ? ORDER BY created_at ASC', [req.params.dealId]);
  res.json(msgs.map(m => ({ ...m, userId: m.user_id, createdAt: m.created_at })));
});
 
// POST /api/chat/:dealId — send a message
router.post('/:dealId', requireAuth, (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
  const db = getDB();
  const deal = db.get('SELECT * FROM deals WHERE id = ?', [req.params.dealId]);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.sponsor_id !== req.user.id && deal.creator_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (['completed', 'paid', 'declined'].includes(deal.status)) {
    return res.status(400).json({ error: 'This deal is closed' });
  }
  const id = 'msg' + uuid().replace(/-/g, '').slice(0, 10);
  db.run(
    'INSERT INTO chat_messages (id, deal_id, user_id, message, created_at) VALUES (?,?,?,?,?)',
    [id, req.params.dealId, req.user.id, message.trim(), Math.floor(Date.now() / 1000)]
  );
  res.status(201).json(db.get('SELECT * FROM chat_messages WHERE id = ?', [id]));
});
 
module.exports = router;
 
