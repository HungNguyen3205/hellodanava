import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';
import { detectChannel, taggedChannel, clickIdChannel } from '../backend/channel.js';

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

  it('recognises Threads, YouTube and the Google app, and leaves other sites as unknown', () => {
    const threadsUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Barcelona 289.0.0.77.109 Instagram 289.0';
    assert.equal(detectChannel(threadsUA), 'Threads');
    assert.equal(detectChannel(UA.chrome, 'https://l.threads.net/?u=x'), 'Threads');
    assert.equal(detectChannel(UA.chrome, 'https://www.threads.com/@danava'), 'Threads');
    assert.equal(detectChannel(UA.chrome, 'android-app://com.instagram.barcelona/'), 'Threads');
    assert.equal(detectChannel(UA.chrome, 'https://www.youtube.com/'), 'YouTube');
    assert.equal(detectChannel(UA.chrome, 'https://m.youtube.com/watch?v=x'), 'YouTube');
    assert.equal(detectChannel(UA.chrome, 'https://youtu.be/x'), 'YouTube');
    assert.equal(detectChannel(UA.chrome, 'android-app://com.google.android.youtube/'), 'YouTube');
    assert.equal(detectChannel(UA.chrome, 'android-app://com.facebook.katana/'), 'Facebook');
    assert.equal(detectChannel(UA.chrome, 'android-app://com.zhiliaoapp.musically/'), 'TikTok');
    assert.equal(detectChannel('Mozilla/5.0 (iPhone) Mobile/15E148 GSA/300.0.1 Safari/604.1'), 'Google');
    assert.equal(detectChannel(UA.chrome, 'https://www.google.com.vn/'), 'Google');
    assert.equal(detectChannel(UA.chrome, 'https://www.linkedin.com/'), null);
    assert.equal(detectChannel(UA.chrome, 'https://notyoutube.com/'), null);
  });

  it('reads utm_source tags and platform click ids', () => {
    const q = s => new URLSearchParams(s);
    assert.equal(taggedChannel(q('utm_source=TikTok')), 'TikTok');
    assert.equal(taggedChannel(q('utm_source=ig')), 'Instagram');
    assert.equal(taggedChannel(q('utm_source=threads.net')), 'Threads');
    assert.equal(taggedChannel(q('zarsrc=31&utm_medium=zalo')), 'Zalo');
    assert.equal(taggedChannel(q('utm_source=newsletter')), null);
    assert.equal(clickIdChannel(q('fbclid=IwAR1')), 'Facebook');
    assert.equal(clickIdChannel(q('ttclid=E.C.P')), 'TikTok');
    assert.equal(clickIdChannel(q('gclid=Cj0')), 'Google');
    assert.equal(clickIdChannel(q('x=1')), null);
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

  it('the same link brings leads from Facebook and TikTok, and the lead list filters by network', async () => {
    const { version } = await (await call(null, '/catalog')).json();
    for (const [ua, phone] of [[UA.facebook, '0900000003'], [UA.tiktok, '0900000004']]) {
      const { ref, cookie } = await click('/r/006', ua);
      const res = await call(null, '/leads', 'POST', { id: randomUUID(), name: 'Khách', business: 'Gym ' + phone, phone,
        model: 'Gym', plan: 'pro', term: 12, extras: [], version, ref }, { Cookie: cookie, 'User-Agent': ua });
      assert.equal(res.status, 201);
    }
    const list = async (cookie, query) => (await (await call(cookie, '/admin/leads?' + query)).json()).items;
    const fb = await list(admin, 'channel=Facebook');
    assert.ok(fb.length >= 1 && fb.every(r => r.channel === 'Facebook'));
    const tt = await list(admin, 'channel=TikTok');
    assert.ok(tt.length >= 2 && tt.every(r => r.channel === 'TikTok'));
    assert.ok((await list(admin, 'channel=TikTok&employee=' + staffId)).every(r => r.employee === 'Hưng'));
    assert.equal((await call(staff, '/admin/leads?channel=Facebook')).status, 403, 'staff have no customer lead list');
    assert.ok((await list(admin, 'channel=bogus')).length >= fb.length + tt.length, 'unknown channel is ignored');
  });

  it('visits without a staff link still get a network, but no staff', async () => {
    await call(null, '/events', 'POST', { kind: 'view', referrer: 'https://m.facebook.com/' }, { Cookie: 'visitor=' + randomUUID(), 'User-Agent': UA.chrome });
    await call(null, '/events', 'POST', { kind: 'view' }, { Cookie: 'visitor=' + randomUUID(), 'User-Agent': UA.chrome });
    const data = await report();
    const direct = Object.fromEntries(data.sources.map(s => [s.channel, s.views]));
    assert.ok(direct.Facebook >= 2, 'Facebook visit without ref is counted as a source');
    assert.equal(direct['Trực tiếp'], 1);
    assert.equal(data.staff.find(r => r.id === staffId).views, 12);
  });

  it('staff only see their own channel breakdown', async () => {
    const mine = await (await call(staff, '/admin/reports?days=7')).json();
    assert.deepEqual(mine.staffChannels.map(r => r.id), [staffId]);
  });

  it('the plain link still finds the network from click ids and utm tags', async () => {
    const before = (await report()).staffChannels.find(r => r.id === staffId).channels;
    const count = (cells, name) => cells[name]?.views || 0;
    // Opened from Facebook in the phone's normal browser: no in-app signature, but fbclid is kept.
    const fb = await click('/r/006?fbclid=IwAR0abc', UA.chrome);
    assert.equal(fb.res.headers.get('set-cookie').split(';')[0], 'via=facebook');
    await click('/r/006?ttclid=E.C.P.abc', UA.chrome);
    // A deliberate tag beats the browser it was opened in.
    await click('/r/006?utm_source=youtube', UA.facebook);
    // The in-app browser is more precise than Meta's shared fbclid.
    await click('/r/006?fbclid=IwAR0abc', UA.instagram);
    const after = (await report()).staffChannels.find(r => r.id === staffId).channels;
    assert.equal(count(after, 'Facebook') - count(before, 'Facebook'), 1);
    assert.equal(count(after, 'TikTok') - count(before, 'TikTok'), 1);
    assert.equal(count(after, 'YouTube') - count(before, 'YouTube'), 1);
    assert.equal(count(after, 'Instagram') - count(before, 'Instagram'), 1);
  });
});

describe('Standard affiliate link hello.danava.vn/?ref=<code>', () => {
  let server, admin, staffId;
  const call = (cookie, path, method = 'GET', body, headers = {}) => fetch(`${server.baseUrl}/api${path}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  // A visit that lands directly on /?ref=... (no /r/ redirect, so no "via" cookie): the page sends its query string.
  const land = (query, userAgent = 'Mozilla/5.0 Chrome/120', referrer = '') => call(null, '/events', 'POST',
    { kind: 'view', ref: new URLSearchParams(query).get('ref'), referrer, query },
    { Cookie: 'visitor=' + randomUUID(), 'User-Agent': userAgent });
  const channels = async () => {
    const row = (await (await call(admin, '/admin/reports?days=7')).json()).staffChannels.find(r => r.id === staffId);
    return Object.fromEntries(Object.entries(row?.channels || {}).map(([k, v]) => [k, v.views]));
  };

  before(async () => {
    server = await startServer({ port: 3989 });
    admin = (await call(null, '/login', 'POST', { email: server.adminEmail, password: server.adminPassword })).headers.get('set-cookie').split(';')[0];
    await call(admin, '/admin/users', 'POST', { name: 'Ref', email: 'ref@test.local', password: 'staff-password-123' });
    staffId = (await (await call(admin, '/admin/links')).json()).staff.find(s => s.email === 'ref@test.local').id;
    const code = (await (await call(admin, '/admin/links', 'POST', { employee: staffId })).json()).code;
    await call(admin, '/admin/link-slug', 'POST', { code, slug: '006' });
  });
  after(async () => { await server?.stop(); });

  it('credits the staff member and reads utm_source, Zalo marker and platform click ids', async () => {
    await land('?ref=006&utm_source=tiktok');
    await land('?ref=006&utm_source=qr');
    await land('?ref=006&zarsrc=31');
    await land('?ref=006&fbclid=abc');
    await land('?ref=006&ttclid=xyz');
    await land('?ref=006', 'Mozilla/5.0 Zalo iOS');
    await land('?ref=006');
    assert.deepEqual(await channels(), { TikTok: 2, QR: 1, Zalo: 2, Facebook: 1, 'Khác': 1 });
  });

  it('is case-insensitive and ignores unknown codes', async () => {
    const total = async () => Object.values(await channels()).reduce((a, b) => a + b, 0);
    const before = await total();
    const { links } = await (await call(admin, '/admin/links')).json();
    const code = links.find(l => l.slug === '006').code;
    await call(admin, '/admin/link-slug', 'POST', { code, slug: 'nam-ref' });
    await land('?ref=NAM-REF');                      // typed in capitals
    await land('?ref=khong-ton-tai&utm_source=tiktok'); // unknown code: not credited to anyone
    await call(admin, '/admin/link-slug', 'POST', { code, slug: '006' });
    assert.equal(await total(), before + 1, 'only the valid code is credited');
  });

  it('a lead from ?ref=006&utm_source=zalo is credited with channel Zalo', async () => {
    const { version } = await (await call(null, '/catalog')).json();
    const res = await call(null, '/leads', 'POST', { id: randomUUID(), name: 'Khách', business: 'Gym Ref', phone: '0900000099',
      model: 'Gym', plan: 'pro', term: 12, extras: [], version, ref: '006', query: '?ref=006&utm_source=zalo' });
    assert.equal(res.status, 201);
    const { items } = await (await call(admin, '/admin/leads')).json();
    assert.equal(items[0].channel, 'Zalo');
    assert.equal(items[0].employee, 'Ref');
    assert.equal(items[0].link, '006');
  });
});
