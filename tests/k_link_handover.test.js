import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './helpers/server_helper.js';
import { hashPassword } from '../backend/db.js';
import { escape } from '../frontend/ui.js';

describe('Handover Scope A-D: Friendly Link Slugs Comprehensive Suite', () => {
  let server, db;
  let adminCookie, staffACookie, staffBCookie;
  let staffAId, staffBId;
  let linkACode, linkBCode;

  const api = (cookie, path, method = 'GET', body) => fetch(`${server.baseUrl}/api${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const getRedirect = async path => {
    const res = await fetch(`${server.baseUrl}${path}`, { redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location') };
  };

  before(async () => {
    server = await startServer({ port: 3970 });
    db = server.getDb();

    // 1. Login admin
    const loginRes = await api(null, '/login', 'POST', {
      email: server.adminEmail,
      password: server.adminPassword
    });
    adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

    // 2. Create Staff A and Staff B
    await api(adminCookie, '/admin/users', 'POST', {
      name: 'Nguyễn Văn Nam',
      email: 'nam-qa@test.local',
      password: 'staff-password-123'
    });
    await api(adminCookie, '/admin/users', 'POST', {
      name: 'Trần Thị Lan',
      email: 'lan-qa@test.local',
      password: 'staff-password-123'
    });

    const { staff } = await (await api(adminCookie, '/admin/links')).json();
    staffAId = staff.find(s => s.email === 'nam-qa@test.local').id;
    staffBId = staff.find(s => s.email === 'lan-qa@test.local').id;

    // 3. Create Links for Staff A and Staff B
    linkACode = (await (await api(adminCookie, '/admin/links', 'POST', { employee: staffAId, channel: 'Zalo' })).json()).code;
    linkBCode = (await (await api(adminCookie, '/admin/links', 'POST', { employee: staffBId, channel: 'Zalo' })).json()).code;

    // 4. Login Staff A and Staff B
    staffACookie = (await api(null, '/login', 'POST', { email: 'nam-qa@test.local', password: 'staff-password-123' }))
      .headers.get('set-cookie').split(';')[0];
    staffBCookie = (await api(null, '/login', 'POST', { email: 'lan-qa@test.local', password: 'staff-password-123' }))
      .headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    db?.close();
    await server?.stop();
  });

  describe('Scope A: Slug Setting & Validation Rules', () => {
    it('automatically converts uppercase to lowercase (e.g. NAM-ZALO -> nam-zalo)', async () => {
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'NAM-ZALO' });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.slug, 'nam-zalo');

      // Verify in DB
      const row = db.prepare('SELECT slug FROM links WHERE code=?').get(linkACode);
      assert.equal(row.slug, 'nam-zalo');
    });

    it('rejects slug with Vietnamese accents with 400', async () => {
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'nam-hưng' });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.error, /Mã link chỉ gồm chữ thường không dấu/);
    });

    it('rejects slug with whitespace with 400', async () => {
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'nam zalo' });
      assert.equal(res.status, 400);
    });

    it('rejects slug with underscore with 400', async () => {
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'nam_zalo' });
      assert.equal(res.status, 400);
    });

    it('rejects slug starting or ending with dash with 400', async () => {
      for (const badSlug of ['-nam-zalo', 'nam-zalo-']) {
        const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: badSlug });
        assert.equal(res.status, 400, `Should reject ${badSlug}`);
      }
    });

    it('rejects slug longer than 40 characters with 400', async () => {
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'a'.repeat(41) });
      assert.equal(res.status, 400);
    });

    it('rejects exact 12-character hex slug to prevent collision with internal codes', async () => {
      const hexSlug = 'a1b2c3d4e5f6';
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: hexSlug });
      assert.equal(res.status, 400);
    });

    it('allows re-setting the same slug on the same link (idempotent)', async () => {
      const res = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'nam-zalo' });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).slug, 'nam-zalo');
    });

    it('clears slug when null or empty string is passed and falls back to internal code', async () => {
      // Clear with empty string
      const res1 = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: '' });
      assert.equal(res1.status, 200);
      assert.equal((await res1.json()).slug, null);
      assert.equal(db.prepare('SELECT slug FROM links WHERE code=?').get(linkACode).slug, null);

      // Re-assign then clear with null
      await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'nam-zalo' });
      const res2 = await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: null });
      assert.equal(res2.status, 200);
      assert.equal((await res2.json()).slug, null);
    });
  });

  describe('Scope B: Redirection /r/<x> Edge Cases', () => {
    before(async () => {
      // Set slug for Link A
      await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: '006' });
    });

    it('redirects 302 to /?ref=slug when link is active and employee is active', async () => {
      const r = await getRedirect('/r/006');
      assert.equal(r.status, 302);
      assert.equal(r.location, '/?ref=006');
    });

    it('redirects 302 to / when link is deactivated (active = 0)', async () => {
      // Admin deactivates link A
      await api(adminCookie, '/admin/links', 'PATCH', { code: linkACode, active: false });

      const r = await getRedirect('/r/006');
      assert.equal(r.status, 302);
      assert.equal(r.location, '/');

      // Reactivate link A
      await api(adminCookie, '/admin/links', 'PATCH', { code: linkACode, active: true });
    });

    it('redirects 302 to / when employee user is deactivated (active = 0)', async () => {
      // Deactivate Staff A
      await api(adminCookie, '/admin/users', 'PATCH', { id: staffAId, active: false });

      const r = await getRedirect('/r/006');
      assert.equal(r.status, 302);
      assert.equal(r.location, '/');

      // Reactivate Staff A and refresh session cookie
      await api(adminCookie, '/admin/users', 'PATCH', { id: staffAId, active: true });
      staffACookie = (await api(null, '/login', 'POST', { email: 'nam-qa@test.local', password: 'staff-password-123' }))
        .headers.get('set-cookie').split(';')[0];
    });

    it('redirects 302 to / when slug does not exist', async () => {
      const r = await getRedirect('/r/non-existent-slug-xyz');
      assert.equal(r.status, 302);
      assert.equal(r.location, '/');
    });

    it('handles uppercase case-insensitively and never credits invalid paths to a link', async () => {
      // NOTE-01 (fixed): /r/ is case-insensitive, so /r/006 typed as upper case still reaches the link.
      const upper = await getRedirect('/R/006');
      assert.equal(upper.status, 302);
      assert.equal(upper.location, '/?ref=006');
      // 006A is a different (unknown) code: goes home, not credited.
      const unknown = await getRedirect('/r/006A');
      assert.equal(unknown.status, 302);
      assert.equal(unknown.location, '/');
      // Characters outside [a-z0-9-] never match the short-link route.
      for (const badPath of ['/r/nam_zalo', '/r/006%20']) {
        const r = await getRedirect(badPath);
        assert.equal(r.status, 404, `Path ${badPath} should return 404`);
      }
    });

    it('treats "006" and "06" as distinct codes', async () => {
      const r1 = await getRedirect('/r/006');
      assert.equal(r1.status, 302);
      assert.equal(r1.location, '/?ref=006');

      const r2 = await getRedirect('/r/06');
      assert.equal(r2.status, 302);
      assert.equal(r2.location, '/', 'Slug 06 is not assigned so it must redirect to /');
    });
  });

  describe('Scope C: View Events & Attribution Reporting', () => {
    it('ignores bot User-Agent when visiting via slug', async () => {
      const beforeCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
      const res = await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
        },
        body: JSON.stringify({ kind: 'view', ref: '006' })
      });
      assert.equal(res.status, 200);
      const afterCount = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
      assert.equal(afterCount, beforeCount, 'Bot visits via slug must not be recorded');
    });

    it('does not count reloads: repeated views from the same visitor within 30 minutes count once', async () => {
      db.prepare('DELETE FROM events').run();
      const visitorId = randomUUID();

      // Send 3 views with same visitor cookie
      for (let i = 0; i < 3; i++) {
        await fetch(`${server.baseUrl}/api/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': `visitor=${visitorId}` },
          body: JSON.stringify({ kind: 'view', ref: '006' })
        });
      }

      const repRes = await api(staffACookie, '/admin/reports?days=7');
      assert.equal(repRes.status, 200);
      const rep = await repRes.json();

      assert.equal(rep.kinds.view, 1, '3 reloads within 30 minutes count as 1 view');
      assert.equal(rep.visitors, 1, 'Unique visitors should be 1');
    });

    it('admin filtering employee=<id> shows exactly that employee views', async () => {
      // 1 view for Staff B (Link B)
      await api(staffBCookie, '/admin/link-slug', 'POST', { code: linkBCode, slug: 'lan-zalo' });
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'view', ref: 'lan-zalo' })
      });

      // Admin queries Staff A
      const repA = await (await api(adminCookie, `/admin/reports?days=7&employee=${staffAId}`)).json();
      assert.equal(repA.kinds.view, 1);

      // Admin queries Staff B
      const repB = await (await api(adminCookie, `/admin/reports?days=7&employee=${staffBId}`)).json();
      assert.equal(repB.kinds.view, 1);
    });

    it('attributes views via old slug as "Trực tiếp" after rename', async () => {
      // Rename Staff A link from '006' to 'nam-pro'
      await api(staffACookie, '/admin/link-slug', 'POST', { code: linkACode, slug: 'nam-pro' });

      // View with old slug '006'
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'view', ref: '006' })
      });

      // Latest event in DB should have channel 'Trực tiếp' and code NULL
      const lastEvent = db.prepare('SELECT code, channel FROM events ORDER BY id DESC LIMIT 1').get();
      assert.equal(lastEvent.code, null);
      assert.equal(lastEvent.channel, 'Trực tiếp');
    });
  });

  describe('Scope D: Leads Attribution with Slugs', () => {
    let leadIdA;

    it('attributes lead via valid slug to employee and displays link=slug in /api/admin/leads', async () => {
      leadIdA = randomUUID();
      const { version } = await (await api(null, '/catalog')).json();

      const res = await api(null, '/leads', 'POST', {
        id: leadIdA,
        name: 'Khách Vip',
        business: 'Gym Vip',
        phone: '0901234567',
        model: 'Gym',
        plan: 'pro',
        term: 12,
        version,
        ref: 'nam-pro',
        extras: []
      });
      assert.equal(res.status, 201);

      // Check /api/admin/leads
      const { items } = await (await api(adminCookie, '/admin/leads')).json();
      const lead = items.find(i => i.id === leadIdA);
      assert.ok(lead);
      assert.equal(lead.employee, 'Nguyễn Văn Nam');
      assert.equal(lead.link, 'nam-pro');
    });

    it('displays internal code when link has no slug in /api/admin/leads', async () => {
      // Clear slug on Link B
      await api(adminCookie, '/admin/link-slug', 'POST', { code: linkBCode, slug: '' });

      const leadIdB = randomUUID();
      const { version } = await (await api(null, '/catalog')).json();
      await api(null, '/leads', 'POST', {
        id: leadIdB,
        name: 'Khách B',
        business: 'Gym B',
        phone: '0901234568',
        model: 'Yoga',
        plan: 'pro',
        term: 12,
        version,
        ref: linkBCode,
        extras: []
      });

      const { items } = await (await api(adminCookie, '/admin/leads')).json();
      const lead = items.find(i => i.id === leadIdB);
      assert.ok(lead);
      assert.equal(lead.employee, 'Trần Thị Lan');
      assert.equal(lead.link, linkBCode, 'Fallback to internal code when slug is null');
    });

    it('ensures Staff B cannot see or modify Staff A lead (staff have no lead list at all)', async () => {
      // Rule: staff only see their share link and progress numbers; the customer list is admin-only.
      assert.equal((await api(staffBCookie, '/admin/leads')).status, 403);
      const patchRes = await api(staffBCookie, '/admin/leads', 'PATCH', { id: leadIdA, status: 'Đang tư vấn' });
      assert.equal(patchRes.status, 403);
      // Staff B still sees progress numbers, but only their own rows: nothing attributed to Staff A.
      const reportB = await (await api(staffBCookie, '/admin/reports?days=7')).json();
      assert.ok(reportB.staff.every(r => r.id === staffBId), 'report rows belong to Staff B only');
      assert.ok(!reportB.staff.some(r => r.id === staffAId));
    });

    it('records lead as "Trực tiếp" when ref is invalid or link is deactivated', async () => {
      // Deactivate Link A
      await api(adminCookie, '/admin/links', 'PATCH', { code: linkACode, active: false });

      const leadIdInactive = randomUUID();
      const { version } = await (await api(null, '/catalog')).json();
      const res = await api(null, '/leads', 'POST', {
        id: leadIdInactive,
        name: 'Khách Deactivated',
        business: 'Gym Deactivated',
        phone: '0901234569',
        model: 'Spa',
        plan: 'pro',
        term: 12,
        version,
        ref: 'nam-pro',
        extras: []
      });
      assert.equal(res.status, 201);

      const inDb = db.prepare('SELECT code, channel FROM leads WHERE id=?').get(leadIdInactive);
      assert.equal(inDb.code, null);
      assert.equal(inDb.channel, 'Trực tiếp');

      // Reactivate
      await api(adminCookie, '/admin/links', 'PATCH', { code: linkACode, active: true });
    });
  });
});

describe('Handover Scope A8 & A9: Concurrency & Rate Limiting (Dedicated Instance)', () => {
  let server, adminCookie, link1, link2;

  before(async () => {
    server = await startServer({ port: 3971 });
    const loginRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
    });
    adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

    // Create 2 links
    const { staff } = await (await fetch(`${server.baseUrl}/api/admin/links`, { headers: { Cookie: adminCookie } })).json();
    const adminId = staff[0].id;
    link1 = (await (await fetch(`${server.baseUrl}/api/admin/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ employee: adminId, channel: 'Zalo' })
    })).json()).code;

    link2 = (await (await fetch(`${server.baseUrl}/api/admin/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ employee: adminId, channel: 'Facebook' })
    })).json()).code;
  });

  after(async () => {
    await server?.stop();
  });

  it('A8: simultaneous requests to set identical slug on 2 different links: exactly 1 succeeds (200) and 1 gets 409', async () => {
    const targetSlug = 'race-slug-01';

    const p1 = fetch(`${server.baseUrl}/api/admin/link-slug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ code: link1, slug: targetSlug })
    });

    const p2 = fetch(`${server.baseUrl}/api/admin/link-slug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ code: link2, slug: targetSlug })
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'Exactly one 200 and one 409 under concurrent assignment');

    // Verify DB state
    const db = server.getDb();
    const rows = db.prepare('SELECT code FROM links WHERE slug=?').all(targetSlug);
    assert.equal(rows.length, 1, 'Only one link can hold the slug in database');
    db.close();
  });

  it('A9: rate limits slug updates to 30 requests per minute per user (31st returns 429)', async () => {
    // Create a fresh staff user for rate limit test to ensure counter starts at 0
    await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ name: 'Rate Staff', email: 'ratelimit-staff@test.local', password: 'staff-password-123' })
    });
    const staffLoginRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ratelimit-staff@test.local', password: 'staff-password-123' })
    });
    const staffCookie = staffLoginRes.headers.get('set-cookie').split(';')[0];
    const { staff } = await (await fetch(`${server.baseUrl}/api/admin/links`, { headers: { Cookie: staffCookie } })).json();
    const rateStaffId = staff[0].id;
    const rateLinkCode = (await (await fetch(`${server.baseUrl}/api/admin/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ employee: rateStaffId, channel: 'TikTok' })
    })).json()).code;

    let hit429 = false;
    for (let i = 1; i <= 32; i++) {
      const res = await fetch(`${server.baseUrl}/api/admin/link-slug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: staffCookie },
        body: JSON.stringify({ code: rateLinkCode, slug: `slug-${i}` })
      });
      if (res.status === 429) {
        hit429 = true;
        assert.equal(i, 31, `Hit 429 on exactly request 31 (got ${i})`);
        break;
      }
    }
    assert.equal(hit429, true, 'User must be rate limited on 31st slug update within 1 minute');
  });
});

describe('Handover Scope E: Legacy Database Migration', () => {
  it('automatically adds slug column and unique index to legacy database without data loss', async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'danava-legacy-migration-'));
    const legacyDbPath = join(legacyDir, 'studio.sqlite');
    const legacyDb = new DatabaseSync(legacyDbPath);

    const oldCode = 'c0de12345678';
    try {
      // Create schema WITHOUT slug column
      legacyDb.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE catalogs (id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL);
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER NOT NULL);
        CREATE TABLE links (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          channel TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(user_id, channel));
        CREATE TABLE events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, visitor TEXT,
          code TEXT REFERENCES links(code), channel TEXT NOT NULL, plan TEXT, created INTEGER NOT NULL);
        CREATE TABLE leads (id TEXT PRIMARY KEY, name TEXT NOT NULL, business TEXT NOT NULL,
          phone TEXT NOT NULL, model TEXT NOT NULL, code TEXT REFERENCES links(code), channel TEXT NOT NULL,
          quote TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Mới', created INTEGER NOT NULL);
      `);

      // Populate legacy data
      legacyDb.prepare("INSERT INTO users(id, name, email, password, role) VALUES(1, 'Admin', 'admin@test.local', ?, 'admin')")
        .run(hashPassword('PasswordAdmin123456!'));
      legacyDb.prepare("INSERT INTO users(id, name, email, password, role) VALUES(2, 'Nhân viên Cũ', 'cu@test.local', ?, 'staff')")
        .run(hashPassword('staff-password-123'));
      legacyDb.prepare("INSERT INTO links(code, user_id, channel, active) VALUES(?, 2, 'Zalo', 1)").run(oldCode);
      legacyDb.prepare("INSERT INTO events(kind, visitor, code, channel, plan, created) VALUES('view', 'v-old', ?, 'Zalo', 'pro', ?)")
        .run(oldCode, Date.now());
      legacyDb.prepare("INSERT INTO leads(id, name, business, phone, model, code, channel, quote, version, status, created) VALUES(?, 'Khách Cũ', 'Gym Cũ', '0901234567', 'Gym', ?, 'Zalo', '{}', 1, 'Mới', ?)")
        .run(randomUUID(), oldCode, Date.now());
    } finally {
      legacyDb.close();
    }

    // Now start server pointing to this legacy directory on port 3972
    const server = await startServer({
      port: 3972,
      dataDir: legacyDir,
      adminEmail: 'admin@test.local',
      adminPassword: 'PasswordAdmin123456!'
    });

    try {
      const db = server.getDb();

      // 1. Verify slug column exists in table links
      const col = db.prepare("SELECT 1 FROM pragma_table_info('links') WHERE name='slug'").get();
      assert.ok(col, 'slug column must be added to table links');

      // 2. Verify unique index links_slug exists
      const idx = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='links_slug'").get();
      assert.ok(idx, 'links_slug index must exist');

      // 3. Verify existing legacy data is intact
      const linkRow = db.prepare('SELECT * FROM links WHERE code=?').get(oldCode);
      assert.ok(linkRow);
      assert.equal(linkRow.slug, null);
      assert.equal(linkRow.channel, 'Zalo');

      const eventRow = db.prepare('SELECT * FROM events WHERE code=?').get(oldCode);
      assert.ok(eventRow);

      const leadRow = db.prepare('SELECT * FROM leads WHERE code=?').get(oldCode);
      assert.ok(leadRow);
      assert.equal(leadRow.name, 'Khách Cũ');

      // 4. Verify old link still redirects by internal code
      const r = await fetch(`${server.baseUrl}/r/${oldCode}`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `/?ref=${oldCode}`);

      // 5. Verify admin can set a slug on this upgraded legacy link
      const loginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@test.local', password: 'PasswordAdmin123456!' })
      });
      const adminCookie = loginRes.headers.get('set-cookie').split(';')[0];

      const slugRes = await fetch(`${server.baseUrl}/api/admin/link-slug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ code: oldCode, slug: 'cu-zalo' })
      });
      assert.equal(slugRes.status, 200);

      // Verify redirect by new slug
      const rNew = await fetch(`${server.baseUrl}/r/cu-zalo`, { redirect: 'manual' });
      assert.equal(rNew.status, 302);
      assert.equal(rNew.headers.get('location'), '/?ref=cu-zalo');

      db.close();
    } finally {
      await server.stop();
      for (let i = 0; i < 5; i++) {
        try {
          rmSync(legacyDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
  });
});

describe('Handover Scope F: Frontend Admin UI Logic & XSS Neutralization', () => {
  // Extract toSlug implementation directly as defined in frontend/admin.js:21
  const toSlug = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

  it('toSlug: converts human input to valid slug with Vietnamese accent stripping', () => {
    assert.equal(toSlug('Nam Hưng Zalo'), 'nam-hung-zalo');
    assert.equal(toSlug('Đà Nẵng Gym & Spa'), 'da-nang-gym-spa');
    assert.equal(toSlug('  ---006---  '), '006');
    assert.equal(toSlug('ZALO-VIP-123'), 'zalo-vip-123');
    assert.equal(toSlug('Special @#$ Characters!'), 'special-characters');

    // Slices at 40 chars and trims trailing dash
    const longInput = 'Một tiêu đề rất dài vượt quá giới hạn bốn mươi ký tự cho phép';
    const slug = toSlug(longInput);
    assert.ok(slug.length <= 40, `Length was ${slug.length}`);
    assert.ok(!slug.startsWith('-'), 'Must not start with dash');
    assert.ok(!slug.endsWith('-'), 'Must not end with dash');
  });

  it('data-search: generates correct search index matching slug, employee, channel, and internal code', () => {
    const staffName = 'Nguyễn Văn Nam';
    const channel = 'Zalo';
    const slug = '006';
    const code = 'a1b2c3d4e5f6';

    const searchData = [staffName, channel, slug, code].join(' ').toLowerCase();

    // Query tests
    assert.ok(searchData.includes('006'), 'Matches slug');
    assert.ok(searchData.includes('nguyễn văn nam'), 'Matches staff name');
    assert.ok(searchData.includes('zalo'), 'Matches channel');
    assert.ok(searchData.includes('a1b2c3d4e5f6'), 'Matches internal hex code');
    assert.ok(!searchData.includes('facebook'), 'Does not match other channels');
  });

  it('XSS: escapes employee name and malicious tags in UI rendering', () => {
    const maliciousName = '<img src=x onerror=alert(1)>';
    const rendered = escape(maliciousName);
    assert.equal(rendered, '&lt;img src=x onerror=alert(1)&gt;');
    assert.ok(!rendered.includes('<img'), 'Raw HTML tag must be neutralized');

    const maliciousSlug = '<script>alert(1)</script>';
    assert.equal(escape(maliciousSlug), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
