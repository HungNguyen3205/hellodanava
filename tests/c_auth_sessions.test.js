import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Scope C: Authentication & Sessions', () => {
  let server;
  let db;

  before(async () => {
    server = await startServer({ port: 3983 });
    db = server.getDb();
  });

  after(async () => {
    if (db) db.close();
    if (server) await server.stop();
  });

  describe('POST /api/login and Email Enumeration Defense', () => {
    it('logs in successfully with valid admin credentials and returns HttpOnly session cookie', async () => {
      const res = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      assert.equal(res.status, 200);
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie);
      assert.match(setCookie, /session=[a-f0-9]{64}/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Max-Age=28800/);
    });

    it('returns identical 401 message for wrong password and non-existent email (no email enumeration)', async () => {
      // Wrong password on existing email
      const wrongPwRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: 'WrongPassword12345!' })
      });
      assert.equal(wrongPwRes.status, 401);
      const wrongPwJson = await wrongPwRes.json();

      // Non-existent email
      const nonExistentRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ghost-user-never-exists@test.local', password: 'AnyPassword12345!' })
      });
      assert.equal(nonExistentRes.status, 401);
      const nonExistentJson = await nonExistentRes.json();

      assert.equal(wrongPwJson.error, 'Email hoặc mật khẩu không đúng.');
      assert.equal(nonExistentJson.error, 'Email hoặc mật khẩu không đúng.');
      assert.equal(wrongPwJson.error, nonExistentJson.error, 'Error message must be identical to prevent enumeration');
    });
  });

  describe('Email Lockout / Rate Limiting (12 failed attempts in 15 mins)', () => {
    it('locks out email on 13th failed attempt and resets counter upon successful login', async () => {
      const targetEmail = 'lockout-test@test.local';

      // 12 failed attempts
      for (let i = 1; i <= 12; i++) {
        const res = await fetch(`${server.baseUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: targetEmail, password: 'bad-password-123' })
        });
        assert.equal(res.status, 401, `Attempt ${i} should return 401`);
      }

      // 13th attempt must return 429
      const lockedRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, password: 'bad-password-123' })
      });
      assert.equal(lockedRes.status, 429);
      const lockedJson = await lockedRes.json();
      assert.match(lockedJson.error, /Vui lòng thử lại sau/);

      // Verify that successful login on admin resets admin's counter if it had failures
      for (let i = 0; i < 5; i++) {
        await fetch(`${server.baseUrl}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: server.adminEmail, password: 'wrong-password' })
        });
      }
      // Successful login resets counter
      const successRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      assert.equal(successRes.status, 200);

      // Can fail again without immediate 429
      const afterSuccessRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: 'wrong-password' })
      });
      assert.equal(afterSuccessRes.status, 401, 'Counter should have been reset');
    });
  });

  describe('Logout & Session Invalidation', () => {
    it('invalidates session on logout and rejects subsequent requests with 401', async () => {
      // Login
      const loginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      assert.equal(loginRes.status, 200);
      const cookieHeader = loginRes.headers.get('set-cookie');

      // Check /api/admin/me works
      const meResBefore = await fetch(`${server.baseUrl}/api/admin/me`, {
        headers: { 'Cookie': cookieHeader }
      });
      assert.equal(meResBefore.status, 200);

      // Logout
      const logoutRes = await fetch(`${server.baseUrl}/api/admin/logout`, {
        method: 'POST',
        headers: { 'Cookie': cookieHeader }
      });
      assert.equal(logoutRes.status, 200);
      const logoutCookie = logoutRes.headers.get('set-cookie');
      assert.match(logoutCookie, /Max-Age=0/);

      // Try using the old session cookie
      const meResAfter = await fetch(`${server.baseUrl}/api/admin/me`, {
        headers: { 'Cookie': cookieHeader }
      });
      assert.equal(meResAfter.status, 401);
      const afterJson = await meResAfter.json();
      assert.equal(afterJson.error, 'Vui lòng đăng nhập.');
    });
  });

  describe('Deactivated Account (active = 0)', () => {
    it('prevents deactivated user from logging in and immediately blocks existing active session', async () => {
      // Create a staff user first
      const adminLoginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      const adminCookie = adminLoginRes.headers.get('set-cookie');

      const staffEmail = 'staff-deactivate-test@test.local';
      const staffPassword = 'StaffPassword1234!';
      await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ name: 'Staff User', email: staffEmail, password: staffPassword })
      });

      // Staff logs in
      const staffLoginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: staffEmail, password: staffPassword })
      });
      assert.equal(staffLoginRes.status, 200);
      const staffCookie = staffLoginRes.headers.get('set-cookie');

      // Verify staff session works
      const meRes1 = await fetch(`${server.baseUrl}/api/admin/me`, {
        headers: { 'Cookie': staffCookie }
      });
      assert.equal(meRes1.status, 200);

      // Admin deactivates staff
      const staffRow = db.prepare('SELECT id FROM users WHERE email=?').get(staffEmail);
      const deactRes = await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ id: staffRow.id, active: false })
      });
      assert.equal(deactRes.status, 200);

      // Existing staff session is immediately blocked
      const meRes2 = await fetch(`${server.baseUrl}/api/admin/me`, {
        headers: { 'Cookie': staffCookie }
      });
      assert.equal(meRes2.status, 401);

      // Deactivated staff cannot log in again
      const loginAgainRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: staffEmail, password: staffPassword })
      });
      assert.equal(loginAgainRes.status, 401);
    });
  });

  describe('Password Change (/api/admin/password)', () => {
    it('validates current password and length limits (12-128 chars)', async () => {
      // Create a staff user for password test
      const adminLoginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      const adminCookie = adminLoginRes.headers.get('set-cookie');

      const staffEmail = 'staff-pw-test@test.local';
      const oldPw = 'OriginalPassword1234!';
      await fetch(`${server.baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminCookie },
        body: JSON.stringify({ name: 'Staff PW', email: staffEmail, password: oldPw })
      });

      const staffLoginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: staffEmail, password: oldPw })
      });
      const staffCookie = staffLoginRes.headers.get('set-cookie');

      // Wrong current password
      const wrongCurrentRes = await fetch(`${server.baseUrl}/api/admin/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
        body: JSON.stringify({ current: 'WrongCurrent1234!', password: 'NewValidPassword1234!' })
      });
      assert.equal(wrongCurrentRes.status, 400);

      // New password too short (< 12 chars)
      const shortPwRes = await fetch(`${server.baseUrl}/api/admin/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
        body: JSON.stringify({ current: oldPw, password: 'Short1234!' })
      });
      assert.equal(shortPwRes.status, 400);

      // New password too long (> 128 chars)
      const longPwRes = await fetch(`${server.baseUrl}/api/admin/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
        body: JSON.stringify({ current: oldPw, password: 'A'.repeat(129) })
      });
      assert.equal(longPwRes.status, 400);

      // Valid password change
      const newPw = 'UpdatedPassword123456!';
      const validChangeRes = await fetch(`${server.baseUrl}/api/admin/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': staffCookie },
        body: JSON.stringify({ current: oldPw, password: newPw })
      });
      assert.equal(validChangeRes.status, 200);

      // Old password cannot log in
      const oldLoginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: staffEmail, password: oldPw })
      });
      assert.equal(oldLoginRes.status, 401);

      // New password logs in successfully
      const newLoginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: staffEmail, password: newPw })
      });
      assert.equal(newLoginRes.status, 200);
    });
  });

  describe('Database Verification: Hashed Passwords & Hashed Session Tokens', () => {
    it('verifies passwords in DB use salt:scrypt format and sessions use sha256 hash', async () => {
      // Check user password hashing
      const users = db.prepare('SELECT email, password FROM users').all();
      assert.ok(users.length > 0);
      for (const u of users) {
        assert.notEqual(u.password, server.adminPassword);
        assert.notEqual(u.password, 'StaffPassword1234!');
        // format: salt:hash
        const parts = u.password.split(':');
        assert.equal(parts.length, 2, 'Password must be salt:hash');
        assert.equal(parts[0].length, 32, 'Salt should be 16 bytes hex (32 chars)');
        assert.equal(parts[1].length, 128, 'scrypt 64-byte key should be 128 chars hex');
      }

      // Check session hashing:
      // Perform a fresh login and capture the token sent in cookie
      const loginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      const cookieHeader = loginRes.headers.get('set-cookie');
      const tokenMatch = cookieHeader.match(/session=([a-f0-9]{64})/);
      assert.ok(tokenMatch);
      const plainToken = tokenMatch[1];

      // In DB, sessions.token must NOT be plainToken, but sha256(plainToken)
      const expectedDbToken = createHash('sha256').update(plainToken).digest('hex');
      const sessionRow = db.prepare('SELECT token FROM sessions WHERE token=?').get(expectedDbToken);
      assert.ok(sessionRow, 'Session must be stored as SHA-256 hash');

      const plainRow = db.prepare('SELECT token FROM sessions WHERE token=?').get(plainToken);
      assert.equal(plainRow, undefined, 'Plaintext session token must NEVER be in database');
    });
  });
});

describe('Scope C: SECURE_COOKIES=1 Flag', () => {
  let secureServer;

  before(async () => {
    secureServer = await startServer({
      port: 3993,
      secureCookies: '1'
    });
  });

  after(async () => {
    if (secureServer) await secureServer.stop();
  });

  it('sets Secure flag on cookies when SECURE_COOKIES=1', async () => {
    // Visitor cookie
    const eventRes = await fetch(`${secureServer.baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'view' })
    });
    const visitorCookie = eventRes.headers.get('set-cookie');
    assert.match(visitorCookie, /;\s*Secure/i, 'Visitor cookie must have Secure flag');

    // Session cookie
    const loginRes = await fetch(`${secureServer.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: secureServer.adminEmail, password: secureServer.adminPassword })
    });
    const sessionCookie = loginRes.headers.get('set-cookie');
    assert.match(sessionCookie, /;\s*Secure/i, 'Session cookie must have Secure flag');
  });
});

