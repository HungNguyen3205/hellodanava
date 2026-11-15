import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Scope F: Leads & Reports', () => {
  let server;
  let db;
  let adminCookie;

  before(async () => {
    server = await startServer({ port: 3996 });
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

  describe('GET /api/admin/leads Pagination & Parameter Resilience', () => {
    let createdIds = [];

    before(() => {
      // Insert 55 leads directly into DB
      const insert = db.prepare(`
        INSERT INTO leads(id, name, business, phone, model, channel, quote, version, status, created)
        VALUES(?, ?, ?, ?, 'Gym', 'Trực tiếp', '{"base":0,"subtotal":0,"items":[]}', 1, 'Mới', ?)
      `);
      const now = Date.now();
      for (let i = 1; i <= 55; i++) {
        const id = randomUUID();
        createdIds.push(id);
        insert.run(id, `Khách hàng ${i}`, `Phòng tập ${i}`, `09012345${i.toString().padStart(2, '0')}`, now + i);
      }
    });

    it('paginates correctly: page 1 returns 50 items with hasNext=true, page 2 returns 5 items with hasNext=false', async () => {
      // Page 1
      const res1 = await fetch(`${server.baseUrl}/api/admin/leads?page=1`, {
        headers: { 'Cookie': adminCookie }
      });
      assert.equal(res1.status, 200);
      const data1 = await res1.json();
      assert.equal(data1.items.length, 50);
      assert.equal(data1.hasNext, true);
      assert.deepEqual(data1.statuses, ['Mới', 'Đang tư vấn', 'Đã chốt', 'Đã đóng']);

      // Page 2
      const res2 = await fetch(`${server.baseUrl}/api/admin/leads?page=2`, {
        headers: { 'Cookie': adminCookie }
      });
      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.items.length, 5);
      assert.equal(data2.hasNext, false);
    });

    it('handles abnormal page values (negative, zero, text, huge) gracefully without crashing', async () => {
      const abnormalPages = ['-1', '0', 'abc', '999999', 'null', 'undefined', '1.5'];
      for (const p of abnormalPages) {
        const res = await fetch(`${server.baseUrl}/api/admin/leads?page=${p}`, {
          headers: { 'Cookie': adminCookie }
        });
        assert.equal(res.status, 200, `Page parameter ${p} should return 200 without crashing`);
        const data = await res.json();
        assert.ok(Array.isArray(data.items));
        assert.equal(typeof data.hasNext, 'boolean');
      }
    });
  });

  describe('PATCH /api/admin/leads Status Validation', () => {
    it('updates lead status with allowed statuses and rejects unlisted statuses with 400', async () => {
      const leadId = randomUUID();
      db.prepare(`
        INSERT INTO leads(id, name, business, phone, model, channel, quote, version, status, created)
        VALUES(?, 'Test Status', 'Gym', '0901234567', 'Gym', 'Trực tiếp', '{"base":0,"subtotal":0,"items":[]}', 1, 'Mới', ?)
      `).run(leadId, Date.now());

      const allowedStatuses = ['Mới', 'Đang tư vấn', 'Đã chốt', 'Đã đóng'];
      for (const status of allowedStatuses) {
        const res = await fetch(`${server.baseUrl}/api/admin/leads`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
          body: JSON.stringify({ id: leadId, status })
        });
        assert.equal(res.status, 200);
        const inDb = db.prepare('SELECT status FROM leads WHERE id=?').get(leadId);
        assert.equal(inDb.status, status);
      }

      // Reject unlisted status
      const forbiddenStatuses = ['Hủy', 'Pending', 'Xóa', '', 123, null];
      for (const status of forbiddenStatuses) {
        const res = await fetch(`${server.baseUrl}/api/admin/leads`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
          body: JSON.stringify({ id: leadId, status })
        });
        assert.equal(res.status, 400, `Status '${status}' should be rejected with 400`);
      }
    });
  });

  describe('GET /api/admin/reports Metrics & Days Handling', () => {
    it('handles days parameter (7, 30, 90) and defaults strange values to 30 without crashing', async () => {
      for (const days of [7, 30, 90]) {
        const res = await fetch(`${server.baseUrl}/api/admin/reports?days=${days}`, {
          headers: { 'Cookie': adminCookie }
        });
        assert.equal(res.status, 200);
        const report = await res.json();
        assert.equal(report.daily.length, days, `daily array length must match days=${days}`);
      }

      // Strange values default to 30
      for (const weirdDays of [0, -1, 99999, 'abc', '']) {
        const res = await fetch(`${server.baseUrl}/api/admin/reports?days=${weirdDays}`, {
          headers: { 'Cookie': adminCookie }
        });
        assert.equal(res.status, 200);
        const report = await res.json();
        assert.equal(report.daily.length, 30, `daily array length for ${weirdDays} must default to 30`);
      }
    });

    it('accurately calculates views, leads, conversion rate, and channels from generated events', async () => {
      // Clear events table for precise verification
      db.prepare('DELETE FROM events').run();

      const visitor1 = randomUUID();
      const visitor2 = randomUUID();

      // Visitor 1: 2 views and 1 interaction and 1 lead
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': `visitor=${visitor1}` },
        body: JSON.stringify({ kind: 'view', plan: 'pro' })
      });
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': `visitor=${visitor1}` },
        body: JSON.stringify({ kind: 'view', plan: 'pro' })
      });
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': `visitor=${visitor1}` },
        body: JSON.stringify({ kind: 'interaction', plan: 'pro' })
      });

      // Submit lead from visitor 1
      await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': `visitor=${visitor1}` },
        body: JSON.stringify({
          id: randomUUID(),
          name: 'Khách A',
          business: 'Gym A',
          phone: '0901234567',
          model: 'Gym',
          plan: 'pro',
          term: 12,
          version: 1,
          extras: []
        })
      });

      // Visitor 2: 1 view only
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': `visitor=${visitor2}` },
        body: JSON.stringify({ kind: 'view', plan: 'premium' })
      });

      // Request report for 7 days
      const res = await fetch(`${server.baseUrl}/api/admin/reports?days=7`, {
        headers: { 'Cookie': adminCookie }
      });
      assert.equal(res.status, 200);
      const rep = await res.json();

      // Total kinds
      assert.equal(rep.kinds.view, 3, 'Total views should be 3');
      assert.equal(rep.kinds.interaction, 1, 'Total interactions should be 1');
      assert.equal(rep.kinds.lead, 1, 'Total leads should be 1');

      // Unique visitors: visitor1 and visitor2
      assert.equal(rep.visitors, 2, 'Unique visitors should be 2');
      assert.equal(rep.engaged, 1, 'Unique engaged should be 1');

      // Conversion rate: 1 converted visitor / 2 total visitors = 0.5 (50%)
      assert.equal(rep.conversion, 0.5, 'Conversion rate should be 1/2 = 0.5');

      // Channel breakdown: all direct ('Trực tiếp')
      const directSource = rep.sources.find(s => s.channel === 'Trực tiếp');
      assert.ok(directSource);
      assert.equal(directSource.views, 3);
      assert.equal(directSource.leads, 1);
    });
  });
});

