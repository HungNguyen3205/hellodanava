import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Editable billing terms (kỳ hạn) in "Gói & module"', () => {
  let server, admin;
  const call = (cookie, path, method = 'GET', body) => fetch(`${server.baseUrl}/api${path}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const draft = async () => (await call(admin, '/admin/catalog')).json();
  const put = draftData => call(admin, '/admin/catalog', 'PUT', draftData);
  const publish = async () => {
    const { version } = await draft();
    return call(admin, '/admin/publish', 'POST', { version });
  };
  const lead = (term, version, plan = 'pro') => call(null, '/leads', 'POST', { id: randomUUID(), name: 'Khách', business: 'Gym T',
    phone: '0900000123', model: 'Gym', plan, term, extras: [], version });

  before(async () => {
    server = await startServer({ port: 3972 });
    admin = (await call(null, '/login', 'POST', { email: server.adminEmail, password: server.adminPassword })).headers.get('set-cookie').split(';')[0];
  });
  after(async () => { await server?.stop(); });

  it('existing catalogs default to 6, 12 and 24 months', async () => {
    assert.deepEqual((await draft()).terms, [6, 12, 24]);
    assert.deepEqual((await (await call(null, '/catalog')).json()).terms, [6, 12, 24]);
  });

  it('admin adds a 1-month term with prices, publishes, and customers can quote it', async () => {
    const d = await draft();
    d.terms = [1, ...d.terms];
    d.plans.forEach(p => { p.prices[1] = p.id === 'start' ? 0 : p.id === 'pro' ? 500000 : null; });
    assert.equal((await put(d)).status, 200);
    assert.equal((await publish()).status, 200);
    const pub = await (await call(null, '/catalog')).json();
    assert.deepEqual(pub.terms, [1, 6, 12, 24]);
    assert.equal(pub.plans.find(p => p.id === 'pro').prices[1], 500000);
    assert.equal((await lead(1, pub.version)).status, 201);
    const { items } = await (await call(admin, '/admin/leads')).json();
    assert.equal(items[0].quote.term, 1);
    assert.equal(items[0].quote.base, 500000);
  });

  it('terms are stored sorted, and a 36-month term can be added', async () => {
    const d = await draft();
    d.terms = [36, ...d.terms];
    d.plans.forEach(p => { p.prices[36] = null; });
    const saved = await (await put(d)).json();
    assert.deepEqual(saved.terms, [1, 6, 12, 24, 36]);
  });

  it('admin removes the 6-month term; quotes for it are then rejected', async () => {
    const d = await draft();
    d.terms = d.terms.filter(t => t !== 6);
    d.plans.forEach(p => { delete p.prices[6]; });
    assert.equal((await put(d)).status, 200);
    assert.equal((await publish()).status, 200);
    const pub = await (await call(null, '/catalog')).json();
    assert.ok(!pub.terms.includes(6));
    assert.ok(pub.plans.every(p => !(6 in p.prices)));
    assert.equal((await lead(6, pub.version)).status, 400);
    assert.equal((await lead(12, pub.version)).status, 201);
  });

  it('rejects invalid term lists and missing prices', async () => {
    const d = await draft();
    for (const terms of [[], [0], [61], [12, 12], [1.5], ['12'], [1, 2, 3, 4, 5, 6, 7, 8, 9], undefined])
      assert.equal((await put({ ...d, terms })).status, 400, JSON.stringify(terms));
    const missingPrice = structuredClone(d);
    missingPrice.terms = [...d.terms, 48];            // new term without a price key on the plans
    missingPrice.plans.forEach(p => { p.prices[48] = -1; });
    assert.equal((await put(missingPrice)).status, 400);
  });

  it('staff cannot edit terms', async () => {
    await call(admin, '/admin/users', 'POST', { name: 'S', email: 's@terms.local', password: 'staff-password-123' });
    const staff = (await call(null, '/login', 'POST', { email: 's@terms.local', password: 'staff-password-123' })).headers.get('set-cookie').split(';')[0];
    assert.equal((await call(staff, '/admin/catalog', 'PUT', await draft())).status, 403);
  });
});
