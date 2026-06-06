const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getAll, run } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

// Supabase Storage helper — uses fetch, no extra SDK needed
const SUPABASE_URL    = process.env.SUPABASE_URL;           // e.g. https://xxxx.supabase.co
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;   // service_role key (server-side only)
const BUCKET          = process.env.SUPABASE_VIDEO_BUCKET || 'creator-videos';

// Upload a base64-encoded video to Supabase Storage and return its public URL
async function uploadToSupabase(base64Data, mimeType, filename) {
  const buffer = Buffer.from(base64Data, 'base64');
  const path   = `${Date.now()}_${filename}`;

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  mimeType,
        'x-upsert':      'false',
      },
      body: buffer,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upload failed: ${err}`);
  }

  // Build the public URL
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return { publicUrl, storagePath: path };
}

// DELETE a file from Supabase Storage
async function deleteFromSupabase(storagePath) {
  await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
    }
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/videos/:creatorId  — public, anyone logged in can view a creator's videos
router.get('/:creatorId', requireAuth, async (req, res) => {
  try {
    const videos = await getAll(
      'SELECT * FROM videos WHERE creator_id = $1 ORDER BY created_at DESC',
      [req.params.creatorId]
    );
    res.json(videos);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/videos  — creator only, upload a new video
// Body: { title, description, file: { data: <base64>, mimeType, name } }
router.post('/', requireAuth, requireRole('creator'), async (req, res) => {
  try {
    const { title, description, file } = req.body;

    if (!title || !file?.data || !file?.mimeType || !file?.name) {
      return res.status(400).json({ error: 'title and file (data, mimeType, name) are required' });
    }

    // Validate mime type
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!allowed.includes(file.mimeType)) {
      return res.status(400).json({ error: 'Only mp4, webm, mov, avi videos are allowed' });
    }

    const { publicUrl, storagePath } = await uploadToSupabase(file.data, file.mimeType, file.name);

    const id = 'v' + uuid().replace(/-/g, '').slice(0, 12);
    await run(
      `INSERT INTO videos (id, creator_id, title, description, url, storage_path, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, req.user.id, title.trim(), (description || '').trim(), publicUrl, storagePath, Math.floor(Date.now() / 1000)]
    );

    const video = { id, creator_id: req.user.id, title, description, url: publicUrl, created_at: Math.floor(Date.now() / 1000) };
    res.status(201).json(video);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/videos/:id  — creator can delete their own video, admin can delete any
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const video = await getAll('SELECT * FROM videos WHERE id = $1', [req.params.id]);
    const v = video[0];
    if (!v) return res.status(404).json({ error: 'Video not found' });

    const isOwner = v.creator_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    // Remove from Supabase Storage
    if (v.storage_path) await deleteFromSupabase(v.storage_path);

    await run('DELETE FROM videos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
