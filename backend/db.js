import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { seed } from './catalog.js';

const dir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dir, {recursive: true, mode: 0o700});
export const db = new DatabaseSync(resolve(dir, 'studio.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS catalogs (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    channel TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(user_id, channel));
  CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, visitor TEXT,
    code TEXT REFERENCES links(code), channel TEXT NOT NULL, plan TEXT, created INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS events_created ON events(created);
  CREATE INDEX IF NOT EXISTS events_interest ON events(visitor,code,plan,created);
  CREATE INDEX IF NOT EXISTS events_code ON events(code,id);
  CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, name TEXT NOT NULL, business TEXT NOT NULL,
    phone TEXT NOT NULL, model TEXT NOT NULL, code TEXT REFERENCES links(code), channel TEXT NOT NULL,
    quote TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Mới', created INTEGER NOT NULL);
`);
// Friendly link name chosen by staff (e.g. "006", "nam-zalo"). Stats stay keyed on the internal code.
// One-way hash of the visitor IP, used only to stop the same person inflating views (never the raw IP).
if (!db.prepare("SELECT 1 FROM pragma_table_info('events') WHERE name='ip'").get())
  db.exec('ALTER TABLE events ADD COLUMN ip TEXT');
db.exec('CREATE INDEX IF NOT EXISTS events_recent ON events(code,created)');
if (!db.prepare("SELECT 1 FROM pragma_table_info('links') WHERE name='slug'").get())
  db.exec('ALTER TABLE links ADD COLUMN slug TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS links_slug ON links(slug)');
const insert = db.prepare('INSERT OR IGNORE INTO catalogs VALUES (?, ?, 1)');
insert.run('draft', JSON.stringify(seed));
insert.run('published', JSON.stringify(seed));

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

export function matches(password, stored) {
  const salt = stored.split(':')[0];
  return timingSafeEqual(Buffer.from(hashPassword(password, salt)), Buffer.from(stored));
}

export function bootstrap({dev = false} = {}) {
  if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) return;
  const configuredEmail = process.env.ADMIN_EMAIL?.trim();
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const generated = dev && !configuredEmail && !configuredPassword;
  const email = generated ? 'admin@hellodanava.test' : configuredEmail;
  const password = generated ? randomBytes(18).toString('base64url') : configuredPassword;
  if (!email?.includes('@') || (password?.length ?? 0) < 12 || password.length > 128)
    throw new Error('Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD (12–128 ký tự) trước khi khởi động lần đầu.');
  const result = db.prepare("INSERT OR IGNORE INTO users(name,email,password,role) VALUES(?,?,?,'admin')")
    .run('Quản trị DANAVA', email.toLowerCase(), hashPassword(password));
  if (generated && result.changes)
    console.log('Tài khoản admin local (hiện một lần)\nEmail: '+email+'\nMật khẩu: '+password);
}

export function catalog(id) {
  const {data, version} = db.prepare('SELECT data, version FROM catalogs WHERE id=?').get(id);
  return {...JSON.parse(data), version};
}
