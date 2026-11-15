import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Friendly link names (slug)', () => {
  let server, admin, staffA, staffB, linkA, linkB;
  const call = (cookie, path, method = 'GET', body) => fetch(`${server.baseUrl}/api${path}`, {
    method, redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const login = async (email, password) =>
    (await call(null, '/login', 'POST', { email, password })).headers.get('set-cookie').split(';')[0];
  const redirect = async path => (await fetch(server.baseUrl + path, { redirect: 'manual' })).headers.get('location');
  const view = (ref, visitor) => fetch(`${server.baseUrl}/api/events`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'visitor=' + visitor }, body: JSON.stringify({ kind: 'view', ref }) });
  const viewsOf = async cookie => (await (await call(cookie, '/admin/reports?days=7')).json()).kinds.view;

  before(async () => {
    server = await startServer({ port: 3985 });
    admin = await login(server.adminEmail, server.adminPassword);
    for (const [name, email] of [['Nam', 'nam@test.local'], ['Lan', 'lan@test.local']])
      assert.equal((await call(admin, '/admin/users', 'POST', { name, email, password: 'staff-password-123' })).status, 201);
    const { staff } = await (await call(admin, '/admin/links')).json();
    const idA = staff.find(s => s.email === 'nam@test.local').id;
    const idB = staff.find(s => s.email === 'lan@test.local').id;
    linkA = (await (await call(admin, '/admin/links', 'POST', { employee: idA, channel: 'Zalo' })).json()).code;
    linkB = (await (await call(admin, '/admin/links', 'POST', { employee: idB, channel: 'Zalo' })).json()).code;
    staffA = await login('nam@test.local', 'staff-password-123');
    staffB = await login('lan@test.local', 'staff-password-123');
  });
  after(async () => { await server?.stop(); });

  it('staff can name their own link "006" and /r/006 redirects with the friendly ref', async () => {
    const res = await call(staffA, '/admin/link-slug', 'POST', { code: linkA, slug: '006' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).slug, '006');
    assert.equal(await redirect('/r/006'), '/?ref=006');
    assert.equal(await redirect('/r/' + linkA), '/?ref=006', 'internal code link keeps working');
  });

  it('visits and leads via ?ref=006 are credited to the owner', async () => {
    await view('006', randomUUID());
    assert.equal(await viewsOf(staffA), 1);
    assert.equal(await viewsOf(staffB), 0);
    const { version } = await (await call(null, '/catalog')).json();
    const lead = await call(null, '/leads', 'POST', { id: randomUUID(), name: 'Khách', business: 'Gym A', phone: '0900000001',
      model: 'Gym', plan: 'pro', term: 12, extras: [], version, ref: '006' });
    assert.equal(lead.status, 201);
    const { items } = await (await call(admin, '/admin/leads')).json();
    assert.equal(items[0].employee, 'Nam');
    assert.equal(items[0].link, '006');
  });

  it('staff cannot rename someone else\'s link or take a name already in use', async () => {
    assert.equal((await call(staffB, '/admin/link-slug', 'POST', { code: linkA, slug: 'lan' })).status, 404);
    assert.equal((await call(staffB, '/admin/link-slug', 'POST', { code: linkB, slug: '006' })).status, 409);
    assert.equal((await call(staffB, '/admin/link-slug', 'POST', { code: linkB, slug: linkA })).status, 400);
    assert.equal((await call(null, '/admin/link-slug', 'POST', { code: linkA, slug: 'x' })).status, 401);
  });

  it('rejects names outside lowercase letters, digits and dashes', async () => {
    for (const slug of ['Nam Hưng', '-006', '006-', 'a_b', 'x'.repeat(41), 'abcdef012345'])
      assert.equal((await call(staffA, '/admin/link-slug', 'POST', { code: linkA, slug })).status, 400, slug);
  });

  it('renaming keeps past stats; the old name stops attributing', async () => {
    assert.equal((await call(staffA, '/admin/link-slug', 'POST', { code: linkA, slug: 'nam-zalo' })).status, 200);
    assert.equal(await viewsOf(staffA), 1, 'history is kept after rename');
    assert.equal(await redirect('/r/006'), '/');
    assert.equal(await redirect('/r/nam-zalo'), '/?ref=nam-zalo');
    await view('nam-zalo', randomUUID());
    assert.equal(await viewsOf(staffA), 2);
  });

  it('clearing the name falls back to the internal code; admin can rename any link', async () => {
    assert.equal((await call(staffA, '/admin/link-slug', 'POST', { code: linkA, slug: '' })).status, 200);
    assert.equal(await redirect('/r/' + linkA), '/?ref=' + linkA);
    assert.equal((await call(admin, '/admin/link-slug', 'POST', { code: linkB, slug: '007' })).status, 200);
    assert.equal(await redirect('/r/007'), '/?ref=007');
  });
});
