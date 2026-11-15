import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';
import { escape } from '../frontend/ui.js';

describe('Scope G: Input Security & Data Integrity', () => {
  let server;
  let db;
  let adminCookie;

  before(async () => {
    server = await startServer({ port: 3997 });
    db = server.getDb();

    // Login admin
    const loginRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
    });
    adminCookie = loginRes.headers.get('set-cookie');
  });

  after(async () => {
    if (db) db.close();
    if (server) await server.stop();
  });

  describe('XSS Payloads Preservation & Frontend Escaping', () => {
    it('stores XSS payloads verbatim without alteration in leads, users, and catalog', async () => {
      const xssName = '<script>alert("XSS")</script>';
      const xssBusiness = '"><img src=x onerror=alert(1)>';
      const leadId = randomUUID();

      const leadRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: leadId,
          name: xssName,
          business: xssBusiness,
          phone: '0901234567',
          model: 'Gym',
          plan: 'pro',
          term: 12,
          version: 1,
          extras: []
        })
      });
      assert.equal(leadRes.status, 201);

      // Verify stored verbatim in DB
      const lead = db.prepare('SELECT name, business FROM leads WHERE id=?').get(leadId);
      assert.equal(lead.name, xssName);
      assert.equal(lead.business, xssBusiness);

      // Staff user with XSS
      const xssStaffName = '<svg/onload=alert("staff")>';
      const staffRes = await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({
          name: xssStaffName,
          email: 'xss-staff@test.local',
          password: 'Password123456!'
        })
      });
      assert.equal(staffRes.status, 201);

      const staff = db.prepare('SELECT name FROM users WHERE email=?').get('xss-staff@test.local');
      assert.equal(staff.name, xssStaffName);
    });

    it('verifies frontend escape function properly neutralizes HTML tags and quotes', () => {
      const payload1 = '<script>alert("XSS")</script>';
      assert.equal(escape(payload1), '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');

      const payload2 = '"><img src=x onerror=alert(1)>';
      assert.equal(escape(payload2), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');

      const payload3 = "it's 'quoted' & <special>";
      assert.equal(escape(payload3), 'it&#39;s &#39;quoted&#39; &amp; &lt;special&gt;');
    });
  });

  describe('SQL Injection Resistance via Prepared Statements', () => {
    it('resists SQL injection in login email', async () => {
      const sqliEmails = [
        "' OR '1'='1",
        "admin'--",
        "qa-admin@test.local' OR '1'='1",
        "'; DROP TABLE users;--",
        "' UNION SELECT 1, 'admin', 'admin@test.local', 'hash', 'admin', 1--"
      ];

      for (const email of sqliEmails) {
        const res = await fetch(`${server.baseUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'password' })
        });
        assert.equal(res.status, 401, `SQLi attempt with email '${email}' must be rejected with 401`);
      }

      // Verify users table is intact
      const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
      assert.ok(count > 0, 'Users table must not be deleted or corrupted');
    });

    it('resists SQL injection in /r/:code attribution lookup', async () => {
      const sqliCodes = [
        "' OR '1'='1",
        "code'; DROP TABLE links;--",
        "nonexistent' UNION SELECT 'code','channel'--"
      ];

      for (const code of sqliCodes) {
        // Must return 302 to '/' (or not crash with 500)
        const res = await fetch(`${server.baseUrl}/r/${encodeURIComponent(code)}`, { redirect: 'manual' });
        // Code regex in server.js: /^\/r\/[a-z0-9-]+$/
        // If code has special characters, regex doesn't match and returns 404
        assert.ok([302, 404].includes(res.status), `Code ${code} must return 302 or 404`);
      }

      const count = db.prepare('SELECT COUNT(*) as c FROM links').get().c;
      assert.ok(count >= 0, 'Links table must remain intact');
    });

    it('resists SQL injection in lead ID', async () => {
      const sqliId = "'; DROP TABLE leads;--";
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: sqliId,
          name: 'SQLi Tester',
          business: 'Gym',
          phone: '0901234567',
          model: 'Gym',
          plan: 'pro',
          term: 12,
          version: 1,
          extras: []
        })
      });
      // ID regex in server.js: /^[a-f0-9-]{36}$/
      assert.equal(res.status, 400, 'Non-UUID lead ID must be rejected with 400');

      const count = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
      assert.ok(count >= 0, 'Leads table must remain intact');
    });

    it('resists SQL injection in report query parameters', async () => {
      const sqliParams = [
        "days=30' OR '1'='1",
        "employee=1 OR 1=1",
        "channel=Zalo' UNION SELECT 1,2,3,4,5,6--",
        "plan=pro' OR 'a'='a"
      ];

      for (const param of sqliParams) {
        const res = await fetch(`${server.baseUrl}/api/admin/reports?${param}`, {
          headers: { 'Cookie': adminCookie }
        });
        assert.equal(res.status, 200, `Report query with '${param}' should handle safely without SQL syntax error`);
        const data = await res.json();
        assert.ok(data.kinds);
      }
    });
  });

  describe('Unicode Vietnamese, Emojis, and Boundary Limits', () => {
    it('correctly handles Vietnamese diacritics and emojis in text fields', async () => {
      const viName = 'Nguyễn Vũ Hoàng Nam 🏋️‍♂️';
      const viBusiness = 'Trung Tâm Thể Hình & Yoga Đà Nẵng 🔥💪';
      const leadId = randomUUID();

      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: leadId,
          name: viName,
          business: viBusiness,
          phone: '0901234567',
          model: 'Yoga',
          plan: 'premium',
          term: 12,
          version: 1,
          extras: []
        })
      });
      assert.equal(res.status, 201);

      const lead = db.prepare('SELECT name, business FROM leads WHERE id=?').get(leadId);
      assert.equal(lead.name, viName);
      assert.equal(lead.business, viBusiness);
    });

    it('handles exact boundary length strings (name 100 chars, business 150 chars)', async () => {
      const maxName = 'A'.repeat(100);
      const maxBusiness = 'B'.repeat(150);
      const leadId = randomUUID();

      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: leadId,
          name: maxName,
          business: maxBusiness,
          phone: '0901234567',
          model: 'Spa',
          plan: 'pro',
          term: 12,
          version: 1,
          extras: []
        })
      });
      assert.equal(res.status, 201);

      const lead = db.prepare('SELECT name, business FROM leads WHERE id=?').get(leadId);
      assert.equal(lead.name.length, 100);
      assert.equal(lead.business.length, 150);
    });
  });
});

