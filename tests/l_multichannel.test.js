import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';
import { detectChannel } from '../backend/channel.js';

const UA = {
  zalo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Zalo iOS/23.10',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0;FBBV/1]',
  messenger: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/440.0.0]',
  tiktok: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Instagram 300.0.0',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
};

describe('detectChannel()', () => {
  it('recognises in-app browsers and referrer sites', () => {
    assert.equal(detectChannel(UA.zalo), 'Zalo');
    assert.equal(detectChannel(UA.facebook), 'Facebook');
    assert.equal(detectChannel(UA.messenger), 'Messenger');
    assert.equal(detectChannel(UA.tiktok), 'TikTok');
    assert.equal(detectChannel(UA.instagram), 'Instagram');
    assert.equal(detectChannel(UA.chrome, 'https://l.facebook.com/l.php?u=x'), 'Facebook');
    assert.equal(detectChannel(UA.chrome, 'https://www.google.com/'), 'Google');
    assert.equal(detectChannel(UA.chrome, 'https://chat.zalo.me/'), 'Zalo');
    assert.equal(detectChannel(UA.chrome, ''), null);
    assert.equal(detectChannel(UA.chrome, 'https://notfacebook.com.evil.io/'), null);
  });
});

describe('One link per staff, channel detected per visit', () => {
  let server, admin, staff, code, staffId;
  const call = (cookie, path, method = 'GET', body, headers = {}) => fetch(`${server.baseUrl}/api${path}`, {
    method, redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const login = async (email, password) =>
    (await call(null, '/login', 'POST', { email, password })).headers.get('set-cookie').split(';')[0];
  // Simulates a real click: GET /r/... (gets the "via" cookie), then the page sends a view with that cookie.
  async function click(path, userAgent, referrer = '') {
    const res = await fetch(server.baseUrl + path, { redirect: 'manual', headers: { 'User-Agent': userAgent, ...(referrer ? { Referer: referrer } : {}) } });
    const via = (res.headers.get('set-cookie') || '').split(';')[0];
    const ref = new URL(res.headers.get('location'), server.baseUrl).searchParams.get('ref');
    const cookie = ['visitor=' + randomUUID(), via].filter(Boolean).join('; ');
    await call(null, '/events', 'POST', { kind: 'view', ref, referrer }, { Cookie: cookie, 'User-Agent': userAgent });
    return { res, ref, cookie };
  }
  const report = async () => (await (await call(admin, '/admin/reports?days=7')).json());

  before(async () => {
    server = await startServer({ port: 3986 });
    admin = await login(server.adminEmail, server.adminPassword);
    await call(admin, '/admin/users', 'POST', { name: 'Hưng', email: 'hung@test.local', password: 'staff-password-123' });
    staffId = (await (await call(admin, '/admin/links')).json()).staff.find(s => s.email === 'hung@test.local').id;
    const created = await call(admin, '/admin/links', 'POST', { employee: staffId });
    assert.equal(created.status, 201);
    code = (await created.json()).code;
    staff = await login('hung@test.local', 'staff-password-123');
    assert.equal((await call(staff, '/admin/link-slug', 'POST', { code, slug: '006' })).status, 200);
  });
  after(async () => { await server?.stop(); });

  it('creates a single multi-channel link per staff', async () => {
    const { links } = await (await call(admin, '/admin/links')).json();
    assert.equal(links.find(l => l.code === code).channel, 'Đa kênh');
    assert.equal((await call(admin, '/admin/links', 'POST', { employee: staffId })).status, 409);
  });

  it('the same /r/006 link is credited to the right network for each click', async () => {
    await click('/r/006', UA.zalo);
    await click('/r/006', UA.zalo);
    await click('/r/006', UA.facebook);
    await click('/r/006', UA.messenger);
    await click('/r/006', UA.tiktok);
    await click('/r/006', UA.chrome, 'https://www.google.com/');
    await click('/r/006/qr', UA.chrome);
    await click('/r/006', UA.chrome);
    const data = await report();
    const row = data.staffChannels.find(r => r.id === staffId);
    assert.deepEqual(Object.fromEntries(Object.entries(row.channels).map(([k, v]) => [k, v.views])),
      { Zalo: 2, Facebook: 1, Messenger: 1, TikTok: 1, Google: 1, QR: 1, 'Khác': 1 });
    assert.equal(data.staff.find(r => r.id === staffId).views, 8);
  });

  it('explicit /r/<code>/<channel> wins over detection, and works case-insensitively', async () => {
    const { res, ref } = await click('/r/006/QR', UA.zalo);
    assert.equal(res.status, 302);
    assert.equal(ref, '006');
    assert.match(res.headers.get('set-cookie'), /^via=qr;/);
    assert.equal((await fetch(server.baseUrl + '/r/006A', { redirect: 'manual' })).headers.get('location'), '/');
    assert.equal((await fetch(server.baseUrl + '/r/NAM', { redirect: 'manual' })).status, 302);
  });

  it('a lead keeps the network of the click that brought the customer', async () => {
    const { ref, cookie } = await click('/r/006', UA.tiktok);
    const { version } = await (await call(null, '/catalog')).json();
    const res = await call(null, '/leads', 'POST', { id: randomUUID(), name: 'Khách', business: 'Gym B', phone: '0900000002',
      model: 'Gym', plan: 'pro', term: 12, extras: [], version, ref }, { Cookie: cookie, 'User-Agent': UA.tiktok });
    assert.equal(res.status, 201);
    const { items } = await (await call(admin, '/admin/leads')).json();
    assert.equal(items[0].channel, 'TikTok');
    assert.equal(items[0].employee, 'Hưng');
    const row = (await report()).staffChannels.find(r => r.id === staffId);
    assert.equal(row.channels.TikTok.leads, 1);
  });

  it('visits without a staff link still get a network, but no staff', async () => {
    await call(null, '/events', 'POST', { kind: 'view', referrer: 'https://m.facebook.com/' }, { Cookie: 'visitor=' + randomUUID(), 'User-Agent': UA.chrome });
    await call(null, '/events', 'POST', { kind: 'view' }, { Cookie: 'visitor=' + randomUUID(), 'User-Agent': UA.chrome });
    const data = await report();
    const direct = Object.fromEntries(data.sources.map(s => [s.channel, s.views]));
    assert.ok(direct.Facebook >= 2, 'Facebook visit without ref is counted as a source');
    assert.equal(direct['Trực tiếp'], 1);
    assert.equal(data.staff.find(r => r.id === staffId).views, 10);
  });

  it('staff only see their own channel breakdown', async () => {
    const mine = await (await call(staff, '/admin/reports?days=7')).json();
    assert.deepEqual(mine.staffChannels.map(r => r.id), [staffId]);
  });
});
