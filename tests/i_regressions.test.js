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
