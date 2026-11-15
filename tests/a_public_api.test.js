import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Scope A: Public API & Static Assets', () => {
  let server;
  let db;

  before(async () => {
    server = await startServer({ port: 3991 });
    db = server.getDb();
  });

  after(async () => {
    if (db) db.close();
    if (server) await server.stop();
  });

  describe('GET /api/catalog', () => {
    it('returns catalog with correct structure and published items', async () => {
      const res = await fetch(`${server.baseUrl}/api/catalog`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
      assert.equal(res.headers.get('cache-control'), 'no-store');

      const data = await res.json();
      assert.ok(Array.isArray(data.plans), 'plans should be array');
      assert.ok(Array.isArray(data.modules), 'modules should be array');
      assert.deepEqual(data.terms, [6, 12, 24]);
      assert.deepEqual(data.models, ['Gym', 'Yoga', 'Pilates', 'Bể bơi', 'Spa']);
      assert.deepEqual(data.apps, ['Quản trị Studio', 'App hội viên', 'App riêng theo thương hiệu']);
      assert.equal(typeof data.version, 'number');
      assert.equal(data.plans.length, 4);

      // Verify no draft modifications are visible
      const draftRow = db.prepare("SELECT data FROM catalogs WHERE id='draft'").get();
      const publishedRow = db.prepare("SELECT data FROM catalogs WHERE id='published'").get();
      assert.equal(JSON.stringify(data.plans), JSON.stringify(JSON.parse(publishedRow.data).plans));
    });
  });

  describe('POST /api/events', () => {
    it('records valid event and sets visitor cookie', async () => {
      const res = await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'view', plan: 'pro' })
      });
      assert.equal(res.status, 200);
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie, 'Should set-cookie for visitor');
      assert.match(setCookie, /visitor=[a-f0-9-]{36}/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);

      // Verify recorded in DB
      const row = db.prepare("SELECT * FROM events WHERE kind='view' ORDER BY id DESC LIMIT 1").get();
      assert.ok(row, 'Event should be recorded');
      assert.equal(row.kind, 'view');
      assert.equal(row.plan, 'pro');
      assert.equal(row.channel, 'Trực tiếp');
    });

    it('ignores invalid event kind without recording', async () => {
      const beforeCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
      const res = await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'invalid_kind_123', plan: 'pro' })
      });
      assert.equal(res.status, 200);
      const afterCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
      assert.equal(afterCount, beforeCount, 'Invalid event kind should not be recorded in DB');
    });

    it('handles non-existent ref gracefully (defaults to channel Trực tiếp and code null)', async () => {
      const res = await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'interaction', ref: 'fake-ref-code-does-not-exist' })
      });
      assert.equal(res.status, 200);
      const row = db.prepare("SELECT * FROM events WHERE kind='interaction' ORDER BY id DESC LIMIT 1").get();
      assert.ok(row);
      assert.equal(row.code, null);
      assert.equal(row.channel, 'Trực tiếp');
    });

    it('reuses existing valid visitor cookie without re-setting', async () => {
      const existingVisitor = randomUUID();
      const res = await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `visitor=${existingVisitor}`
        },
        body: JSON.stringify({ kind: 'view' })
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('set-cookie'), null, 'Should not re-set visitor cookie if already valid');

      const row = db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 1").get();
      assert.equal(row.visitor, existingVisitor);
    });

    it('ignores bot user agent', async () => {
      const beforeCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
      const res = await fetch(`${server.baseUrl}/api/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
        },
        body: JSON.stringify({ kind: 'view' })
      });
      assert.equal(res.status, 200);
      const afterCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
      assert.equal(afterCount, beforeCount, 'Bot visits must not be recorded');
    });
  });

  describe('POST /api/leads', () => {
    function validLeadPayload(overrides = {}) {
      return {
        id: randomUUID(),
        name: 'Nguyễn Văn A',
        business: 'Danang Fitness Center',
        phone: '0901234567',
        model: 'Gym',
        plan: 'pro',
        term: 12,
        version: 1,
        extras: [
          { id: 'module-14', quantity: 2 } // 500,000 * 2 * 12 = 12,000,000
        ],
        ...overrides
      };
    }

    it('creates a lead successfully and calculates price correctly', async () => {
      const payload = validLeadPayload();
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.id, payload.id);

      // Verify in DB
      const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(payload.id);
      assert.ok(lead);
      assert.equal(lead.name, payload.name);
      assert.equal(lead.business, payload.business);
      assert.equal(lead.phone, payload.phone);
      assert.equal(lead.model, payload.model);
      assert.equal(lead.status, 'Mới');

      const quote = JSON.parse(lead.quote);
      // Pro 12-month base: 5,000,000. module-14: 500,000/mo * 2 * 12 = 12,000,000. Total = 17,000,000
      assert.equal(quote.base, 5000000);
      assert.equal(quote.subtotal, 17000000);
      assert.equal(quote.needsReview, false);

      // Verify lead event recorded
      const leadEvent = db.prepare("SELECT * FROM events WHERE kind='lead' AND plan='pro' ORDER BY id DESC LIMIT 1").get();
      assert.ok(leadEvent);
      assert.equal(leadEvent.kind, 'lead');
      assert.equal(leadEvent.plan, 'pro');
    });

    it('is idempotent: same ID does not create duplicate or recalculate', async () => {
      const payload = validLeadPayload();
      const res1 = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      assert.equal(res1.status, 201);

      // Send again with same ID but modified subtotal/prices/data
      const res2 = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, name: 'Tên Đã Đổi', phone: '0999999999' })
      });
      assert.equal(res2.status, 201);
      const json2 = await res2.json();
      assert.equal(json2.id, payload.id);

      const count = db.prepare('SELECT COUNT(*) as c FROM leads WHERE id=?').get(payload.id).c;
      assert.equal(count, 1, 'Duplicate ID must not create second row');

      const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(payload.id);
      assert.equal(lead.name, payload.name, 'Original row must not be modified');
    });

    it('rejects stale catalog version with 409', async () => {
      const payload = validLeadPayload({ version: 999 });
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 409);
      const json = await res.json();
      assert.match(json.error, /Bảng giá vừa cập nhật/);
    });

    it('rejects honeypot website field with 400', async () => {
      const payload = validLeadPayload({ website: 'https://spam-bot.xyz' });
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 400);
    });

    it('rejects invalid or missing name with 400', async () => {
      for (const badName of ['', '   ', null, 123, 'a'.repeat(101)]) {
        const res = await fetch(`${server.baseUrl}/api/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validLeadPayload({ name: badName }))
        });
        assert.equal(res.status, 400, `Should reject name: ${badName}`);
      }
    });

    it('rejects invalid or missing business with 400', async () => {
      for (const badBusiness of ['', '   ', null, 123, 'a'.repeat(151)]) {
        const res = await fetch(`${server.baseUrl}/api/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validLeadPayload({ business: badBusiness }))
        });
        assert.equal(res.status, 400, `Should reject business: ${badBusiness}`);
      }
    });

    it('rejects invalid phone numbers with 400', async () => {
      const badPhones = [
        '0901234abc',   // contains letters
        '1234567',      // only 7 digits (min is 8)
        'a'.repeat(25), // too long
        '+84 1234',     // only 6 digits
        12345678,       // not a string
        null
      ];
      for (const phone of badPhones) {
        const res = await fetch(`${server.baseUrl}/api/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validLeadPayload({ phone }))
        });
        assert.equal(res.status, 400, `Should reject phone: ${phone}`);
      }
    });

    it('rejects model not in models list with 400', async () => {
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({ model: 'Tennis' }))
      });
      assert.equal(res.status, 400);
    });

    it('rejects non-existent plan with 400', async () => {
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({ plan: 'non_existent_plan' }))
      });
      assert.equal(res.status, 400);
    });

    it('rejects extras with invalid quantity or state with 400', async () => {
      // module-0 is 'included' in pro plan (not extra or contact)
      const invalidModuleRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({
          extras: [{ id: 'module-0', quantity: 1 }]
        }))
      });
      assert.equal(invalidModuleRes.status, 400, 'Module with state included cannot be in extras');

      // Quantity <= 0
      const zeroQtyRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({
          extras: [{ id: 'module-14', quantity: 0 }]
        }))
      });
      assert.equal(zeroQtyRes.status, 400, 'Quantity 0 should be rejected');

      // Quantity > 99
      const overQtyRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({
          extras: [{ id: 'module-14', quantity: 100 }]
        }))
      });
      assert.equal(overQtyRes.status, 400, 'Quantity > 99 should be rejected');

      // Quantity decimal
      const decimalQtyRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({
          extras: [{ id: 'module-14', quantity: 1.5 }]
        }))
      });
      assert.equal(decimalQtyRes.status, 400, 'Decimal quantity should be rejected');

      // Quantity string
      const strQtyRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({
          extras: [{ id: 'module-14', quantity: '2' }]
        }))
      });
      assert.equal(strQtyRes.status, 400, 'String quantity should be rejected');

      // Duplicate extra module id
      const dupQtyRes = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validLeadPayload({
          extras: [
            { id: 'module-14', quantity: 1 },
            { id: 'module-14', quantity: 2 }
          ]
        }))
      });
      assert.equal(dupQtyRes.status, 400, 'Duplicate extra modules should be rejected');
    });

    it('ignores client attempts to forge price or subtotal', async () => {
      const payload = validLeadPayload({
        base: 0,
        subtotal: 1000,
        extras: [
          { id: 'module-14', quantity: 1, price: 10, total: 10 }
        ]
      });
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      assert.equal(res.status, 201);

      const lead = db.prepare('SELECT quote FROM leads WHERE id=?').get(payload.id);
      const quote = JSON.parse(lead.quote);
      // Correct base: 5,000,000. module-14: 500,000 * 1 * 12 = 6,000,000. subtotal = 11,000,000
      assert.equal(quote.base, 5000000);
      assert.equal(quote.items[0].price, 500000);
      assert.equal(quote.items[0].total, 6000000);
      assert.equal(quote.subtotal, 11000000);
    });
  });

  describe('GET /r/:code', () => {
    let testCode;
    let inactiveCode;

    before(() => {
      const user = db.prepare("SELECT id FROM users WHERE role='admin'").get();
      testCode = 'link-qa-active';
      inactiveCode = 'link-qa-inactive';

      db.prepare("INSERT OR REPLACE INTO links(code, user_id, channel, active) VALUES(?, ?, 'Zalo', 1)").run(testCode, user.id);
      db.prepare("INSERT OR REPLACE INTO links(code, user_id, channel, active) VALUES(?, ?, 'Facebook', 0)").run(inactiveCode, user.id);
    });

    it('redirects 302 to /?ref=code when link is active', async () => {
      const res = await fetch(`${server.baseUrl}/r/${testCode}`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), `/?ref=${testCode}`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });

    it('redirects 302 to / when link is inactive', async () => {
      const res = await fetch(`${server.baseUrl}/r/${inactiveCode}`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/');
    });

    it('redirects 302 to / when link does not exist', async () => {
      const res = await fetch(`${server.baseUrl}/r/non-existent-link`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/');
    });
  });

  describe('Static files & Path Traversal', () => {
    const assets = [
      ['/', 'text/html; charset=utf-8'],
      ['/admin', 'text/html; charset=utf-8'],
      ['/app.js', 'text/javascript; charset=utf-8'],
      ['/style.css', 'text/css; charset=utf-8'],
      ['/scene.js', 'text/javascript; charset=utf-8'],
      ['/vendor/three.module.min.js', 'text/javascript; charset=utf-8'],
      ['/logo.png', 'image/png'],
      ['/mark.png', 'image/png']
    ];

    for (const [path, expectedContentType] of assets) {
      it(`serves ${path} with 200 and Content-Type ${expectedContentType}`, async () => {
        const res = await fetch(`${server.baseUrl}${path}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), expectedContentType);
      });
    }

    it('returns 404 for missing font /fonts/UTM-Eremitage.ttf', async () => {
      const res = await fetch(`${server.baseUrl}/fonts/UTM-Eremitage.ttf`);
      assert.equal(res.status, 404);
    });

    it('prevents path traversal and leaks of backend files', async () => {
      const forbiddenPaths = [
        '/../backend/db.js',
        '/%2e%2e/backend/db.js',
        '/backend/server.js',
        '/.env',
        '/data/studio.sqlite'
      ];
      for (const path of forbiddenPaths) {
        const res = await fetch(`${server.baseUrl}${path}`);
        assert.equal(res.status, 404, `Path traversal attempt on ${path} must return 404`);
      }
    });
  });
});

describe('Scope A: Rate Limiting (Dedicated Instance)', () => {
  let rateServer;

  before(async () => {
    rateServer = await startServer({ port: 3981 });
  });

  after(async () => {
    if (rateServer) await rateServer.stop();
  });

  it('rate limits /api/leads to 50 requests per minute', async () => {
    const validPayload = {
      id: randomUUID(),
      name: 'Khách Test',
      business: 'Gym Test',
      phone: '0901234567',
      model: 'Gym',
      plan: 'pro',
      term: 12,
      version: 1,
      extras: []
    };

    let hit429 = false;
    for (let i = 0; i < 52; i++) {
      const res = await fetch(`${rateServer.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validPayload, id: randomUUID() })
      });
      if (res.status === 429) {
        hit429 = true;
        assert.equal(i >= 50, true, `Hit 429 on request index ${i} (expected after 50)`);
        break;
      }
    }
    assert.equal(hit429, true, 'Must return 429 after 50 lead requests in 1 minute');
  });
});
