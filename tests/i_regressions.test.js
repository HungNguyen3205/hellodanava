import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

const json = (cookie, extra = {}) => ({ 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra });

async function sendLeads(server, count, forwardedFor) {
  const { version } = await (await fetch(`${server.baseUrl}/api/catalog`)).json();
  const statuses = [];
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: json(null, forwardedFor ? { 'X-Forwarded-For': forwardedFor(i) } : {}),
      body: JSON.stringify({ id: randomUUID(), name: 'QA', business: 'QA Gym', phone: '0900000000',
        model: 'Gym', plan: 'pro', term: 12, extras: [], version })
    });
    statuses.push(res.status);
  }
  return statuses;
}

describe('Regression BUG-01: reports survive events outside the report window', () => {
  let server, db, cookie;
  before(async () => {
    server = await startServer({ port: 3981 });
    db = server.getDb();
    const res = await fetch(`${server.baseUrl}/api/login`, { method: 'POST', headers: json(),
      body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword }) });
    cookie = res.headers.get('set-cookie').split(';')[0];
  });
  after(async () => { db?.close(); await server?.stop(); });

  it('returns 200 and ignores an event dated in the future', async () => {
    db.prepare("INSERT INTO events(kind,visitor,channel,plan,created) VALUES('view','v-future','Trực tiếp','pro',?)")
      .run(Date.now() + 10 * 86400000);
    db.prepare("INSERT INTO events(kind,visitor,channel,plan,created) VALUES('view','v-now','Trực tiếp','pro',?)")
      .run(Date.now());
    for (const days of [7, 30, 90]) {
      const res = await fetch(`${server.baseUrl}/api/admin/reports?days=${days}`, { headers: { Cookie: cookie } });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.daily.length, days);
      assert.equal(data.daily.reduce((sum, d) => sum + d.views, 0), data.kinds.view);
      assert.equal(data.kinds.view, 1, 'future event must not be counted');
    }
  });
});

describe('Regression BUG-02: rate limit uses the proxy-appended client IP', () => {
  it('TRUST_PROXY unset: X-Forwarded-For is ignored, all requests share the socket IP', async () => {
    const server = await startServer({ port: 3982 });
    try {
      const statuses = await sendLeads(server, 51, i => `10.0.0.${i}`);
      assert.equal(statuses.at(-1), 429);
    } finally { await server.stop(); }
  });

  it('TRUST_PROXY=1: different real clients behind the proxy get separate limits', async () => {
    const server = await startServer({ port: 3983, env: { TRUST_PROXY: '1' } });
    try {
      const statuses = await sendLeads(server, 55, i => `203.0.113.${i}`);
      assert.ok(statuses.every(s => s === 201), `unexpected statuses: ${statuses}`);
    } finally { await server.stop(); }
  });

  it('TRUST_PROXY=1: a client cannot dodge the limit by forging earlier X-Forwarded-For entries', async () => {
    const server = await startServer({ port: 3984, env: { TRUST_PROXY: '1' } });
    try {
      const statuses = await sendLeads(server, 51, i => `1.2.3.${i}, 198.51.100.7`);
      assert.equal(statuses.at(-1), 429);
    } finally { await server.stop(); }
  });
});

describe('Regression: HEAD requests are answered like GET', () => {
  it('pages, assets and the public API return 200 to HEAD with no body', async () => {
    const server = await startServer({ port: 3987 });
    try {
      for (const path of ['/', '/admin', '/style.css', '/vendor/three.module.min.js', '/api/catalog']) {
        const res = await fetch(server.baseUrl + path, { method: 'HEAD' });
        assert.equal(res.status, 200, path);
        assert.equal((await res.text()).length, 0, `${path} HEAD must not send a body`);
      }
      const short = await fetch(server.baseUrl + '/r/unknown', { method: 'HEAD', redirect: 'manual' });
      assert.equal(short.status, 302);
      const post = await fetch(server.baseUrl + '/api/leads', { method: 'HEAD' });
      assert.equal(post.status, 404, 'POST-only endpoints stay closed to HEAD');
    } finally { await server.stop(); }
  });
});

describe('Live updates: /api/admin/pulse', () => {
  it('changes when something happens, and is scoped to the staff member', async () => {
    const server = await startServer({ port: 3988 });
    const call = (cookie, path, method = 'GET', body) => fetch(`${server.baseUrl}/api${path}`, { method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const login = async (email, password) => (await call(null, '/login', 'POST', { email, password })).headers.get('set-cookie').split(';')[0];
    const stamp = async cookie => (await (await call(cookie, '/admin/pulse')).json()).stamp;
    try {
      assert.equal((await call(null, '/admin/pulse')).status, 401);
      const admin = await login(server.adminEmail, server.adminPassword);
      for (const [name, email] of [['A', 'a@pulse.local'], ['B', 'b@pulse.local']])
        await call(admin, '/admin/users', 'POST', { name, email, password: 'staff-password-123' });
      const { staff } = await (await call(admin, '/admin/links')).json();
      const codeOf = async email => (await (await call(admin, '/admin/links', 'POST', { employee: staff.find(s => s.email === email).id })).json()).code;
      const codeA = await codeOf('a@pulse.local');
      await codeOf('b@pulse.local');
      const staffA = await login('a@pulse.local', 'staff-password-123');
      const staffB = await login('b@pulse.local', 'staff-password-123');

      const [admin0, a0, b0] = [await stamp(admin), await stamp(staffA), await stamp(staffB)];
      await call(null, '/events', 'POST', { kind: 'view', ref: codeA });
      assert.notEqual(await stamp(admin), admin0, 'admin sees any new activity');
      assert.notEqual(await stamp(staffA), a0, 'staff A sees activity on their link');
      assert.equal(await stamp(staffB), b0, 'staff B is not woken by staff A activity');
    } finally { await server.stop(); }
  });
});

describe('Anti-cheat: reloading or self-visits do not inflate views', () => {
  it('counts one view per browser per link per 30 minutes, ignores logged-in staff, still counts other people', async () => {
    const server = await startServer({ port: 3968 });
    const call = (cookie, path, method = 'GET', body, headers = {}) => fetch(`${server.baseUrl}/api${path}`, { method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const login = async (email, password) => (await call(null, '/login', 'POST', { email, password })).headers.get('set-cookie').split(';')[0];
    try {
      const admin = await login(server.adminEmail, server.adminPassword);
      await call(admin, '/admin/users', 'POST', { name: 'Cheat', email: 'c@test.local', password: 'staff-password-123' });
      const id = (await (await call(admin, '/admin/links')).json()).staff.find(s => s.email === 'c@test.local').id;
      const code = (await (await call(admin, '/admin/links', 'POST', { employee: id })).json()).code;
      const staff = await login('c@test.local', 'staff-password-123');
      const views = async () => (await (await call(staff, '/admin/reports?days=7')).json()).kinds.view;
      const db = server.getDb();

      const one = 'visitor=' + randomUUID();
      for (let i = 0; i < 10; i++) await call(null, '/events', 'POST', { kind: 'view', ref: code }, { Cookie: one });
      assert.equal(await views(), 1, '10 reloads in a row = 1 view');

      for (let i = 0; i < 5; i++) await call(null, '/events', 'POST', { kind: 'view', ref: code }, { Cookie: staff + '; visitor=' + randomUUID() });
      assert.equal(await views(), 1, 'staff opening their own link while logged in is not counted');

      await call(null, '/events', 'POST', { kind: 'view', ref: code }, { Cookie: 'visitor=' + randomUUID() });
      assert.equal(await views(), 2, 'a different person is counted');

      // After 30 minutes the same browser counts again (simulate by ageing the stored view).
      db.prepare("UPDATE events SET created = created - 31*60*1000 WHERE visitor = ?").run(one.split('=')[1]);
      await call(null, '/events', 'POST', { kind: 'view', ref: code }, { Cookie: one });
      assert.equal(await views(), 3, 'same browser counts again after 30 minutes');
      db.close();
    } finally { await server.stop(); }
  });
});

describe('Anti-cheat: same public IP in incognito / cleared cookies', () => {
  it('one view per public IP per link per 30 minutes; private IPs are never merged', async () => {
    const server = await startServer({ port: 3967, env: { TRUST_PROXY: '1' } });
    const call = (cookie, path, method = 'GET', body, headers = {}) => fetch(`${server.baseUrl}/api${path}`, { method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    try {
      const admin = (await call(null, '/login', 'POST', { email: server.adminEmail, password: server.adminPassword })).headers.get('set-cookie').split(';')[0];
      await call(admin, '/admin/users', 'POST', { name: 'Ip', email: 'ip@test.local', password: 'staff-password-123' });
      const id = (await (await call(admin, '/admin/links')).json()).staff.find(s => s.email === 'ip@test.local').id;
      const code = (await (await call(admin, '/admin/links', 'POST', { employee: id })).json()).code;
      const view = ip => call(null, '/events', 'POST', { kind: 'view', ref: code }, { Cookie: 'visitor=' + randomUUID(), 'X-Forwarded-For': ip });
      const views = async () => (await (await call(admin, '/admin/reports?days=7&employee=' + id)).json()).kinds.view;

      for (let i = 0; i < 5; i++) await view('203.0.113.7');      // new cookie each time (incognito), same public IP
      assert.equal(await views(), 1, 'same public IP counted once');
      await view('198.51.100.20');
      assert.equal(await views(), 2, 'another public IP counted');
      await view('10.0.0.5'); await view('10.0.0.5');                // private IP: real client unknown, do not merge
      assert.equal(await views(), 4, 'private addresses are not de-duplicated by IP');
      const stored = server.getDb().prepare("SELECT ip FROM events WHERE ip IS NOT NULL LIMIT 1").get().ip;
      assert.match(stored, /^[0-9a-f]{32}$/, 'only a hash is stored, never the raw IP');
    } finally { await server.stop(); }
  });
});
