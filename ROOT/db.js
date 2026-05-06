const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
 
const FILE = path.join(__dirname, 'creaspo.db');
 
// Wrap sql.js with a synchronous-style API + auto-persist to disk
class DB {
  constructor(raw) {
    this.raw = raw;
    this._timer = null;
  }
 
  _persist() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try { fs.writeFileSync(FILE, Buffer.from(this.raw.export())); }
      catch (e) { console.error('[db] persist error:', e.message); }
    }, 150);
  }
 
  exec(sql) {
    this.raw.run(sql);
    return this;
  }
 
  run(sql, params) {
    this.raw.run(sql, params || []);
    this._persist();
    return this;
  }
 
  get(sql, params) {
    const r = this.raw.exec(sql, params || []);
    if (!r.length || !r[0].values.length) return undefined;
    const { columns, values } = r[0];
    return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
  }
 
  all(sql, params) {
    const r = this.raw.exec(sql, params || []);
    if (!r.length) return [];
    const { columns, values } = r[0];
    return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
  }
 
  // Supports both positional array args and named object args (@name style)
  prepare(sql) {
    const db = this;
    const norm = (args) => {
      if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) return args[0];
      if (args.length === 0) return [];
      return args;
    };
    return {
      run(...args)  { db.run(sql, norm(args)); return { changes: 1 }; },
      get(...args)  { return db.get(sql, norm(args)); },
      all(...args)  { return db.all(sql, norm(args)); },
    };
  }
 
  transaction(fn) {
    const db = this;
    return function (...args) {
      db.raw.run('BEGIN');
      try   { fn(...args); db.raw.run('COMMIT'); db._persist(); }
      catch (e) { db.raw.run('ROLLBACK'); throw e; }
    };
  }
}
 
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  role TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  joined_at INTEGER NOT NULL DEFAULT 0, profile TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, sponsor_id TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT DEFAULT '', budget TEXT DEFAULT 'TBD',
  num_creators INTEGER NOT NULL DEFAULT 1, requirements TEXT DEFAULT '',
  deadline TEXT DEFAULT '', niche TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL,
  sponsor_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  offered_price TEXT DEFAULT '', price TEXT DEFAULT '',
  deliverables TEXT DEFAULT '', note TEXT DEFAULT '', deadline TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  history TEXT NOT NULL DEFAULT '[]', submission TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL,
  creator_id TEXT NOT NULL, sponsor_id TEXT NOT NULL,
  message TEXT DEFAULT '', rate TEXT DEFAULT '', deliverables TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT NOT NULL,
  access_token TEXT NOT NULL, refresh_token TEXT DEFAULT NULL,
  expires_at INTEGER DEFAULT NULL, platform_data TEXT NOT NULL DEFAULT '{}',
  connected_at INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id, platform)
);
CREATE TABLE IF NOT EXISTS verify_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT NOT NULL,
  link TEXT NOT NULL, code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, deal_id TEXT NOT NULL, user_id TEXT NOT NULL,
  message TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0
);
`;
 
function seed(db) {
  const row = db.get('SELECT COUNT(*) as n FROM users');
  if (row && row.n > 0) return;
  console.log('[db] seeding demo data...');
 
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  const h = p => bcrypt.hashSync(p, 10);
  const fd = n => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
 
  const userSQL = 'INSERT INTO users (id,email,password,role,name,status,joined_at,profile) VALUES (?,?,?,?,?,?,?,?)';
  [
    ['admin', 'admin@creaspo.io', h('admin3428./blrp'), 'admin', 'Creaspo Admin', 'active', now, '{}'],
  ].forEach(u => db.run(userSQL, u));
  console.log('[db] seed complete.');
}
 
let _instance = null;
 
async function initDB() {
  const SQL = await initSqlJs();
  const raw = fs.existsSync(FILE)
    ? new SQL.Database(fs.readFileSync(FILE))
    : new SQL.Database();
  console.log(fs.existsSync(FILE) ? '[db] loaded from disk' : '[db] new database');
  const db = new DB(raw);
  db.exec(SCHEMA);
  seed(db);
  db.raw.run(''); // flush
  fs.writeFileSync(FILE, Buffer.from(raw.export())); // immediate save after seed
  _instance = db;
  return db;
}
 
function getDB() {
  if (!_instance) throw new Error('DB not ready — call initDB() first');
  return _instance;
}
 
module.exports = { initDB, getDB };
