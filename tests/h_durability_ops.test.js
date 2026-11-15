import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from './helpers/server_helper.js';

describe('Scope H: Durability & Concurrency', () => {
  describe('50 Concurrent /api/leads Requests', () => {
    it('handles 50 concurrent leads without database lock errors or data loss', async () => {
      const server = await startServer({ port: 3998 });
      const db = server.getDb();

      try {
        const payloadBase = {
          name: 'Khách Đồng Thời',
          business: 'Gym Đồng Thời',
          phone: '0901234567',
          model: 'Gym',
          plan: 'pro',
          term: 12,
          version: 1,
          extras: []
        };

        const ids = Array.from({ length: 50 }, () => randomUUID());
        const startTimestamp = Date.now();

        // Fire 50 requests simultaneously
        const promises = ids.map((id, index) =>
          fetch(`${server.baseUrl}/api/leads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payloadBase, id, name: `Khách ${index + 1}` })
          })
        );

        const responses = await Promise.all(promises);
        const statuses = responses.map(r => r.status);

        // Every request must succeed with 201 (within 50/min rate limit)
        const count201 = statuses.filter(s => s === 201).length;
        assert.equal(count201, 50, `All 50 concurrent requests must return 201. Statuses: ${JSON.stringify(statuses)}`);

        // Check SQLite DB
        const leadsCount = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
        assert.equal(leadsCount, 50, 'All 50 leads must be persisted in database without loss');

        // Check no duplicate IDs
        const distinctCount = db.prepare('SELECT COUNT(DISTINCT id) as c FROM leads').get().c;
        assert.equal(distinctCount, 50, 'All 50 leads must have distinct IDs');
      } finally {
        db.close();
        await server.stop();
      }
    });
  });

  describe('Server Restart Persistence with Same DATA_DIR', () => {
    it('persists data, accounts, and active sessions across server restart', async () => {
      const persistDir = mkdtempSync(join(tmpdir(), 'danava-persist-'));
      const port = 3988;

      try {
        // 1. Start server instance 1
        const server1 = await startServer({
          port,
          dataDir: persistDir,
          adminEmail: 'qa-admin@test.local',
          adminPassword: 'SuperStrongPassword16!'
        });

        // Login to get session
        const loginRes = await fetch(`${server1.baseUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'qa-admin@test.local', password: 'SuperStrongPassword16!' })
        });
        assert.equal(loginRes.status, 200);
        const sessionCookie = loginRes.headers.get('set-cookie');

        // Create a lead
        const leadId = randomUUID();
        await fetch(`${server1.baseUrl}/api/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: leadId,
            name: 'Khách Persist',
            business: 'Gym Persist',
            phone: '0901234567',
            model: 'Gym',
            plan: 'pro',
            term: 12,
            version: 1,
            extras: []
          })
        });

        // 2. Shut down server 1
        await server1.stop();

        // 3. Start server instance 2 pointing to the same dataDir
        const server2 = await startServer({
          port,
          dataDir: persistDir,
          adminEmail: 'qa-admin@test.local',
          adminPassword: 'SuperStrongPassword16!'
        });

        // 4. Verify previous session cookie is still valid
        const meRes = await fetch(`${server2.baseUrl}/api/admin/me`, {
          headers: { 'Cookie': sessionCookie }
        });
        assert.equal(meRes.status, 200, 'Session must remain valid after server restart');
        const me = await meRes.json();
        assert.equal(me.email, 'qa-admin@test.local');

        // 5. Verify lead persisted
        const db2 = server2.getDb();
        const leadRow = db2.prepare('SELECT * FROM leads WHERE id=?').get(leadId);
        assert.ok(leadRow, 'Lead row must exist after restart');
        assert.equal(leadRow.name, 'Khách Persist');
        db2.close();

        await server2.stop();
      } finally {
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(persistDir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    });
  });

  describe('First-time Startup without ADMIN_PASSWORD', () => {
    it('crashes cleanly with clear error message when ADMIN_PASSWORD is missing in production mode', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'danava-missing-pw-'));
      const port = 3989;

      try {
        const proc = spawn(process.execPath, ['backend/server.js'], {
          env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            DATA_DIR: tempDir,
            ADMIN_EMAIL: 'qa-admin@test.local'
            // ADMIN_PASSWORD is deliberately omitted
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });

        const exitCode = await new Promise(res => {
          proc.on('exit', code => res(code));
        });

        assert.equal(exitCode, 1, 'Server should exit with error code 1 when ADMIN_PASSWORD is missing');
        assert.match(stderr, /Cấu hình ADMIN_EMAIL và ADMIN_PASSWORD \(12–128 ký tự\) trước khi khởi động lần đầu\./);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('generates random admin credentials and logs to stdout when run with --dev flag', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'danava-dev-mode-'));
      const port = 3990;

      try {
        const proc = spawn(process.execPath, ['backend/server.js', '--dev'], {
          env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            DATA_DIR: tempDir
            // ADMIN_EMAIL and ADMIN_PASSWORD both omitted
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });

        // Wait for server ready
        await new Promise((res, rej) => {
          const timeout = setTimeout(() => rej(new Error('Timeout waiting for dev server')), 5000);
          proc.stdout.on('data', () => {
            if (stdout.includes('Hello DANAVA · cổng ' + port)) {
              clearTimeout(timeout);
              res();
            }
          });
        });

        assert.match(stdout, /Tài khoản admin local \(hiện một lần\)/);
        assert.match(stdout, /Email: admin@hellodanava\.test/);
        assert.match(stdout, /Mật khẩu: [a-zA-Z0-9_-]+/);

        proc.kill('SIGKILL');
      } finally {
        for (let i = 0; i < 5; i++) {
          try {
            rmSync(tempDir, { recursive: true, force: true });
            break;
          } catch {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    });
  });
});

