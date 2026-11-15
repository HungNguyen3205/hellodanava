import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Scope E: Catalog & Publish', () => {
  let server;
  let db;
  let adminCookie;

  before(async () => {
    server = await startServer({ port: 3995 });
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

  async function getDraft() {
    const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
      headers: { 'Cookie': adminCookie }
    });
    assert.equal(res.status, 200);
    return res.json();
  }

  describe('PUT /api/admin/catalog Validation', () => {
    it('rejects modified plans length with 400', async () => {
      const draft = await getDraft();
      // Remove 1 plan
      const badData = { ...draft, plans: draft.plans.slice(0, 3) };
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(badData)
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Cấu hình gói không hợp lệ.');
    });

    it('rejects empty or whitespace plan name with 400', async () => {
      const draft = await getDraft();
      draft.plans[0].name = '   ';
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
    });

    it('rejects negative price in plan with 400', async () => {
      const draft = await getDraft();
      draft.plans[1].prices[12] = -5000000;
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
    });

    it('rejects non-integer price in plan with 400', async () => {
      const draft = await getDraft();
      draft.plans[1].prices[12] = 5000000.5;
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
    });

    it('rejects price exceeding limit (> 10,000,000,000) with 400', async () => {
      const draft = await getDraft();
      draft.plans[1].prices[12] = 10000000001;
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
    });

    it('rejects multiple featured plans with 400', async () => {
      const draft = await getDraft();
      draft.plans[0].featured = true;
      draft.plans[1].featured = true;
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Chọn tối đa một gói nổi bật.');
    });

    it('rejects empty module name with 400', async () => {
      const draft = await getDraft();
      draft.modules[0].name = '';
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
    });

    it('rejects module description > 300 chars with 400', async () => {
      const draft = await getDraft();
      draft.modules[0].description = 'D'.repeat(301);
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
    });

    it('rejects module state outside allowed states with 400', async () => {
      const draft = await getDraft();
      draft.modules[0].plans['pro'] = 'invalid_state';
      const res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify(draft)
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Kiểm tra dữ liệu từng module.');
    });
  });

  describe('Optimistic Concurrency Control (409)', () => {
    it('returns 409 when updating draft with stale version', async () => {
      const draft = await getDraft();
      const currentVersion = draft.version;

      // Update draft successfully once
      draft.plans[1].name = 'Pro Updated';
      const update1Res = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ ...draft, version: currentVersion })
      });
      assert.equal(update1Res.status, 200);
      const updatedDraft = await update1Res.json();
      assert.equal(updatedDraft.version, currentVersion + 1);

      // Now another admin attempts to update using the old version
      const staleRes = await fetch(`${server.baseUrl}/api/admin/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ ...draft, version: currentVersion })
      });
      assert.equal(staleRes.status, 409);
      const json = await staleRes.json();
      assert.match(json.error, /Bản nháp đã thay đổi/);
    });
  });

  describe('Publish Workflow & Version Propagation', () => {
    it('rejects publish with stale version with 409', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ version: 9999 })
      });
      assert.equal(res.status, 409);
    });

    it('publishes new version, updates /api/catalog, and rejects leads using old version with 409', async () => {
      // 1. Check current published catalog
      const pubBeforeRes = await fetch(`${server.baseUrl}/api/catalog`);
      const pubBefore = await pubBeforeRes.json();
      const oldPubVersion = pubBefore.version;

      // 2. Fetch current draft
      const draft = await getDraft();
      const draftVersion = draft.version;

      // 3. Publish draft
      const publishRes = await fetch(`${server.baseUrl}/api/admin/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ version: draftVersion })
      });
      assert.equal(publishRes.status, 200);

      // 4. Verify /api/catalog has new version and updated content
      const pubAfterRes = await fetch(`${server.baseUrl}/api/catalog`);
      const pubAfter = await pubAfterRes.json();
      assert.equal(pubAfter.version, oldPubVersion + 1, 'Published version must increment');
      assert.equal(pubAfter.plans.find(p => p.id === 'pro').name, 'Pro Updated');

      // 5. Try submitting lead with old version -> must return 409
      const oldLeadRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          name: 'Khách Test',
          business: 'Gym Test',
          phone: '0901234567',
          model: 'Gym',
          plan: 'pro',
          term: 12,
          version: oldPubVersion,
          extras: []
        })
      });
      assert.equal(oldLeadRes.status, 409);
      const oldLeadJson = await oldLeadRes.json();
      assert.match(oldLeadJson.error, /Bảng giá vừa cập nhật/);

      // 6. Submit lead with new version -> succeeds 201
      const newLeadRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          name: 'Khách Test',
          business: 'Gym Test',
          phone: '0901234567',
          model: 'Gym',
          plan: 'pro',
          term: 12,
          version: pubAfter.version,
          extras: []
        })
      });
      assert.equal(newLeadRes.status, 201);
    });
  });
});

