const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Simple query helpers
async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res;
}

async function getOne(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

async function getAll(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return res;
}

// ─── Schema ───────────────────────────────────────────────────────────────────
async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      joined_at BIGINT NOT NULL DEFAULT 0,
      profile TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      sponsor_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      budget TEXT DEFAULT 'TBD',
      num_creators INTEGER NOT NULL DEFAULT 1,
      requirements TEXT DEFAULT '',
      deadline TEXT DEFAULT '',
      niche TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      sponsor_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      offered_price TEXT DEFAULT '',
      price TEXT DEFAULT '',
      deliverables TEXT DEFAULT '',
      note TEXT DEFAULT '',
      deadline TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      history TEXT NOT NULL DEFAULT '[]',
      submission TEXT DEFAULT NULL,
      created_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      sponsor_id TEXT NOT NULL,
      message TEXT DEFAULT '',
      rate TEXT DEFAULT '',
      deliverables TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT DEFAULT NULL,
      expires_at BIGINT DEFAULT NULL,
      platform_data TEXT NOT NULL DEFAULT '{}',
      connected_at BIGINT NOT NULL DEFAULT 0,
      UNIQUE(user_id, platform)
    );
    CREATE TABLE IF NOT EXISTS verify_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      link TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT 0
    );
  `);

  // Seed admin if no users exist
  const count = await getOne('SELECT COUNT(*) as n FROM users');
  if (parseInt(count.n) === 0) {
    console.log('[db] seeding admin...');
    const hash = bcrypt.hashSync('admin3428./blrp', 10);
    await run(
      'INSERT INTO users (id, email, password, role, name, status, joined_at, profile) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      ['admin', 'admin@creaspo.io', hash, 'admin', 'Creaspo Admin', 'active', Math.floor(Date.now() / 1000), '{}']
    );
    console.log('[db] admin seeded.');
  }

  console.log('[db] ready.');
}

module.exports = { pool, query, getOne, getAll, run, initDB };
