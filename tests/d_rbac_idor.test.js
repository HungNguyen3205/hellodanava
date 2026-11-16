import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Scope D: RBAC & IDOR', () => {
  let server;
  let db;

  let adminCookie;
  let adminUser;
  let staffACookie;
  let staffAUser;
  let staffBCookie;
  let staffBUser;

  let staffALinkCode;
  let staffBLinkCode;

  let staffALeadId;
  let staffBLeadId;

  before(async () => {
    server = await startServer({ port: 3994 });
    db = server.getDb();

    // 1. Admin login
    const adminLoginRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
    });
    adminCookie = adminLoginRes.headers.get('set-cookie');
    const meAdminRes = await fetch(`${server.baseUrl}/api/admin/me`, { headers: { 'Cookie': adminCookie } });
    adminUser = await meAdminRes.json();

    // 2. Create Staff A and Staff B
    const pwA = 'StaffAPassword123!';
    const pwB = 'StaffBPassword123!';
    const emailA = 'staff-a@test.local';
    const emailB = 'staff-b@test.local';

    await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
      body: JSON.stringify({ name: 'Nhân viên A', email: emailA, password: pwA })
    });
    await fetch(`${server.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
      body: JSON.stringify({ name: 'Nhân viên B', email: emailB, password: pwB })
    });

    // 3. Login Staff A
    const loginARes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: pwA })
    });
    staffACookie = loginARes.headers.get('set-cookie');
    const meARes = await fetch(`${server.baseUrl}/api/admin/me`, { headers: { 'Cookie': staffACookie } });
    staffAUser = await meARes.json();

    // 4. Login Staff B
    const loginBRes = await fetch(`${server.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailB, password: pwB })
    });
    staffBCookie = loginBRes.headers.get('set-cookie');
    const meBRes = await fetch(`${server.baseUrl}/api/admin/me`, { headers: { 'Cookie': staffBCookie } });
    staffBUser = await meBRes.json();

    // 5. Admin creates links for Staff A and Staff B
    const linkARes = await fetch(`${server.baseUrl}/api/admin/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
      body: JSON.stringify({ employee: staffAUser.id, channel: 'Zalo' })
    });
    staffALinkCode = (await linkARes.json()).code;

    const linkBRes = await fetch(`${server.baseUrl}/api/admin/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
      body: JSON.stringify({ employee: staffBUser.id, channel: 'Facebook' })
    });
    staffBLinkCode = (await linkBRes.json()).code;

    // 6. Create Lead for Staff A and Lead for Staff B
    staffALeadId = randomUUID();
    await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: staffALeadId,
        name: 'Khách của A',
        business: 'Gym A',
        phone: '0901234567',
        model: 'Gym',
        plan: 'pro',
        term: 12,
        version: 1,
        ref: staffALinkCode,
        extras: []
      })
    });

    staffBLeadId = randomUUID();
    await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: staffBLeadId,
        name: 'Khách của B',
        business: 'Gym B',
        phone: '0912345678',
        model: 'Yoga',
        plan: 'pro',
        term: 12,
        version: 1,
        ref: staffBLinkCode,
        extras: []
      })
    });
  });

  after(async () => {
    if (db) db.close();
    if (server) await server.stop();
  });

  describe('Unauthenticated Access (401)', () => {
    const adminEndpoints = [
      ['GET', '/api/admin/me'],
      ['POST', '/api/admin/password'],
      ['GET', '/api/admin/reports'],
      ['GET', '/api/admin/links'],
      ['POST', '/api/admin/link-action'],
      ['GET', '/api/admin/leads'],
      ['PATCH', '/api/admin/leads'],
      ['POST', '/api/admin/users'],
      ['PATCH', '/api/admin/users'],
      ['POST', '/api/admin/links'],
      ['PATCH', '/api/admin/links'],
      ['GET', '/api/admin/catalog'],
      ['PUT', '/api/admin/catalog'],
      ['POST', '/api/admin/publish'],
      ['POST', '/api/admin/logout']
    ];

    for (const [method, path] of adminEndpoints) {
      it(`blocks unauthenticated ${method} ${path} with 401`, async () => {
        const res = await fetch(`${server.baseUrl}${path}`, {
          method,
          headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
          body: method !== 'GET' ? JSON.stringify({}) : undefined
        });
        assert.equal(res.status, 401, `${method} ${path} without cookie must return 401`);
        const json = await res.json();
        assert.equal(json.error, 'Vui lòng đăng nhập.');
      });
    }
  });

  describe('Staff Forbidden Endpoints (403)', () => {
    const adminOnlyEndpoints = [
      ['POST', '/api/admin/users', { name: 'X', email: 'x@x.com', password: 'password12345' }],
      ['PATCH', '/api/admin/users', { id: 1, active: false }],
      ['POST', '/api/admin/links', { employee: 1, channel: 'Zalo' }],
      ['PATCH', '/api/admin/links', { code: 'any', active: false }],
      ['GET', '/api/admin/catalog', null],
      ['PUT', '/api/admin/catalog', { plans: [], modules: [] }],
      ['POST', '/api/admin/publish', { version: 1 }]
    ];

    for (const [method, path, body] of adminOnlyEndpoints) {
      it(`forbids staff from accessing ${method} ${path} with 403`, async () => {
        const res = await fetch(`${server.baseUrl}${path}`, {
          method,
          headers: {
            'Cookie': staffACookie,
            ...(body ? { 'Content-Type': 'application/json' } : {})
          },
          body: body ? JSON.stringify(body) : undefined
        });
        assert.equal(res.status, 403, `Staff accessing ${method} ${path} must receive 403`);
        const json = await res.json();
        assert.equal(json.error, 'Cần quyền quản trị.');
      });
    }
  });

  describe('Staff Data Isolation (Staff A vs Staff B)', () => {
    it('isolates links: Staff A only sees their own links, not Staff B links', async () => {
      const resA = await fetch(`${server.baseUrl}/api/admin/links`, { headers: { 'Cookie': staffACookie } });
      assert.equal(resA.status, 200);
      const dataA = await resA.json();

      assert.equal(dataA.staff.length, 1);
      assert.equal(dataA.staff[0].id, staffAUser.id);
      assert.equal(dataA.links.length, 1);
      assert.equal(dataA.links[0].code, staffALinkCode);
      assert.ok(!dataA.links.some(l => l.code === staffBLinkCode), 'Staff A must not see Staff B links');

      // Admin sees both
      const resAdmin = await fetch(`${server.baseUrl}/api/admin/links`, { headers: { 'Cookie': adminCookie } });
      const dataAdmin = await resAdmin.json();
      assert.ok(dataAdmin.links.some(l => l.code === staffALinkCode));
      assert.ok(dataAdmin.links.some(l => l.code === staffBLinkCode));
    });

    it('isolates leads: staff cannot list customer leads; admin filter per employee keeps them apart', async () => {
      // Rule: staff only see their share link and progress numbers, never the customer list.
      const resA = await fetch(`${server.baseUrl}/api/admin/leads`, { headers: { 'Cookie': staffACookie } });
      assert.equal(resA.status, 403);
      const dataA = await resA.json();
      assert.equal(dataA.items, undefined, 'no lead data in a 403 response');

      // Admin sees both
      const resAdmin = await fetch(`${server.baseUrl}/api/admin/leads`, { headers: { 'Cookie': adminCookie } });
      const dataAdmin = await resAdmin.json();
      assert.ok(dataAdmin.items.some(lead => lead.id === staffALeadId));
      assert.ok(dataAdmin.items.some(lead => lead.id === staffBLeadId));
    });

    it('isolates reports: Staff A passing ?employee=<B.id> cannot see Staff B report', async () => {
      // Record a view event for Staff B link
      await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'view', ref: staffBLinkCode, plan: 'pro' })
      });

      // Staff A requests report trying to snoop on Staff B
      const res = await fetch(`${server.baseUrl}/api/admin/reports?employee=${staffBUser.id}&days=30`, {
        headers: { 'Cookie': staffACookie }
      });
      assert.equal(res.status, 200);
      const report = await res.json();

      // Staff A's returned report must NOT contain Staff B in staff list
      assert.ok(!report.staff.some(s => s.id === staffBUser.id), 'Staff A report must not include Staff B stats');
      // If Staff A has staff entry, it must only be Staff A
      for (const s of report.staff) {
        assert.equal(s.id, staffAUser.id);
      }
    });

    it('prevents link-action on other staff links (returns 404)', async () => {
      // Staff A tries to call link-action on Staff B's link
      const res = await fetch(`${server.baseUrl}/api/admin/link-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffACookie },
        body: JSON.stringify({ code: staffBLinkCode, kind: 'copy' })
      });
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error, 'Không tìm thấy link.');

      // Staff A calls link-action on own link -> succeeds 200
      const ownRes = await fetch(`${server.baseUrl}/api/admin/link-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffACookie },
        body: JSON.stringify({ code: staffALinkCode, kind: 'copy' })
      });
      assert.equal(ownRes.status, 200);
    });
  });

  describe('Admin Self-Lock & Admin-Lock Protection', () => {
    it('prevents admin from deactivating self (returns 404)', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ id: adminUser.id, active: false })
      });
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error, 'Không tìm thấy nhân viên.');

      // Verify admin remains active in DB
      const adminInDb = db.prepare('SELECT active FROM users WHERE id=?').get(adminUser.id);
      assert.equal(adminInDb.active, 1);
    });

    it('prevents admin from deactivating another admin user (returns 404)', async () => {
      // Insert a second admin directly into DB for test
      db.prepare("INSERT INTO users(name, email, password, role, active) VALUES(?, ?, ?, 'admin', 1)")
        .run('Admin 2', 'admin2@test.local', 'dummy-hash');
      const secondAdmin = db.prepare('SELECT id FROM users WHERE email=?').get('admin2@test.local');

      const res = await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ id: secondAdmin.id, active: false })
      });
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(json.error, 'Không tìm thấy nhân viên.');

      const inDb = db.prepare('SELECT active FROM users WHERE id=?').get(secondAdmin.id);
      assert.equal(inDb.active, 1);
    });
  });

  describe('IDOR Testing', () => {
    it('prevents Staff A from patching any lead status (returns 403)', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/leads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffACookie },
        body: JSON.stringify({ id: staffBLeadId, status: 'Đang tư vấn' })
      });
      assert.equal(res.status, 403);

      // Verify Staff B lead status remains 'Mới'
      const leadB = db.prepare('SELECT status FROM leads WHERE id=?').get(staffBLeadId);
      assert.equal(leadB.status, 'Mới');
    });

    it('returns 404 when patching non-existent lead ID', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/leads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ id: randomUUID(), status: 'Đang tư vấn' })
      });
      assert.equal(res.status, 404);
    });

    it('returns 404 when patching non-existent user ID', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ id: 999999, active: false })
      });
      assert.equal(res.status, 404);
    });

    it('returns 404 when patching non-existent link code', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/links`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ code: 'non-existent-link-code', active: false })
      });
      assert.equal(res.status, 404);
    });
  });
});

