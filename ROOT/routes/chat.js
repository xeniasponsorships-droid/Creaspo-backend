const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getOne, getAll, run } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/:dealId', requireAuth, async (req, res) => {
  try {
    const deal = await getOne('SELECT * FROM deals WHERE id = $1', [req.params.dealId]);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (deal.sponsor_id !== req.user.id && deal.creator_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const msgs = await getAll('SELECT * FROM chat_messages WHERE deal_id = $1 ORDER BY created_at ASC', [req.params.dealId]);
    res.json(msgs.map(m => ({ ...m, userId: m.user_id, createdAt: m.created_at })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:dealId', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    const deal = await getOne('SELECT * FROM deals WHERE id = $1', [req.params.dealId]);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (deal.sponsor_id !== req.user.id && deal.creator_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (['paid', 'declined'].includes(deal.status)) return res.status(400).json({ error: 'Deal is closed' });
    const id = 'msg' + uuid().replace(/-/g, '').slice(0, 10);
    await run('INSERT INTO chat_messages (id, deal_id, user_id, message, created_at) VALUES ($1,$2,$3,$4,$5)', [id, req.params.dealId, req.user.id, message.trim(), Math.floor(Date.now() / 1000)]);
    res.status(201).json(await getOne('SELECT * FROM chat_messages WHERE id = $1', [id]));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
