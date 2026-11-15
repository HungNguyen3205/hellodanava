import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server_helper.js';

describe('Scope B: Body & Headers', () => {
  let server;
  let db;

  before(async () => {
    server = await startServer({ port: 3992 });
    db = server.getDb();
  });

  after(async () => {
    if (db) db.close();
    if (server) await server.stop();
  });

  describe('Content-Type Validation', () => {
    it('returns 415 when Content-Type is not application/json for POST endpoints', async () => {
      const endpoints = [
        ['POST', '/api/leads'],
        ['POST', '/api/events'],
        ['POST', '/api/login']
      ];

      for (const [method, path] of endpoints) {
        // Missing Content-Type
        const resNoHeader = await fetch(`${server.baseUrl}${path}`, {
          method,
          body: 'name=Test'
        });
        assert.equal(resNoHeader.status, 415, `${path} should return 415 without Content-Type`);
        const json1 = await resNoHeader.json();
        assert.equal(json1.error, 'Yêu cầu JSON.');

        // text/plain
        const resText = await fetch(`${server.baseUrl}${path}`, {
          method,
          headers: { 'Content-Type': 'text/plain' },
          body: 'Hello DANAVA'
        });
        assert.equal(resText.status, 415, `${path} should return 415 for text/plain`);

        // multipart/form-data
        const resForm = await fetch(`${server.baseUrl}${path}`, {
          method,
          headers: { 'Content-Type': 'multipart/form-data' },
          body: 'form-data'
        });
        assert.equal(resForm.status, 415, `${path} should return 415 for multipart/form-data`);
      }
    });
  });

  describe('JSON Body Parsing', () => {
    it('returns 400 for malformed JSON syntax', async () => {
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ "invalid_json": true, '
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Dữ liệu không hợp lệ.');
    });

    it('returns 400 when body is JSON array', async () => {
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ id: 1 }])
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Dữ liệu không hợp lệ.');
    });

    it('returns 400 when body is JSON null', async () => {
      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null'
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.error, 'Dữ liệu không hợp lệ.');
    });

    it('returns 400 when body is JSON primitive (boolean or number)', async () => {
      for (const primitive of ['123', 'true', '"a string"']) {
        const res = await fetch(`${server.baseUrl}/api/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: primitive
        });
        assert.equal(res.status, 400);
      }
    });
  });

  describe('Body Size Limit (256 KB)', () => {
    it('returns 413 when body > 256 KB (262144 bytes) and server remains responsive', async () => {
      // 262145 bytes payload
      const padding = 'x'.repeat(262140);
      const largeBody = JSON.stringify({ padding });

      assert.ok(Buffer.byteLength(largeBody) > 262144, 'Payload must exceed 256KB');

      const res = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: largeBody
      });
      assert.equal(res.status, 413);
      const json = await res.json();
      assert.equal(json.error, 'Dữ liệu quá lớn.');

      // Verify server is alive and responds immediately to subsequent requests
      const checkRes = await fetch(`${server.baseUrl}/api/catalog`);
      assert.equal(checkRes.status, 200);
    });
  });

  describe('Security Headers on All Responses', () => {
    const requiredSecurityHeaders = [
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
      ['content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"]
    ];

    it('enforces security headers on 200 static response', async () => {
      const res = await fetch(`${server.baseUrl}/`);
      assert.equal(res.status, 200);
      for (const [header, expected] of requiredSecurityHeaders) {
        assert.equal(res.headers.get(header), expected);
      }
      assert.equal(res.headers.get('cache-control'), 'no-cache');
    });

    it('enforces security headers and no-store on 200 API response', async () => {
      const res = await fetch(`${server.baseUrl}/api/catalog`);
      assert.equal(res.status, 200);
      for (const [header, expected] of requiredSecurityHeaders) {
        assert.equal(res.headers.get(header), expected);
      }
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });

    it('enforces security headers and no-store on 302 redirect', async () => {
      const res = await fetch(`${server.baseUrl}/r/any-code`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      for (const [header, expected] of requiredSecurityHeaders) {
        assert.equal(res.headers.get(header), expected);
      }
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });

    it('enforces security headers and no-store on 401 unauthenticated response', async () => {
      const res = await fetch(`${server.baseUrl}/api/admin/me`);
      assert.equal(res.status, 401);
      for (const [header, expected] of requiredSecurityHeaders) {
        assert.equal(res.headers.get(header), expected);
      }
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });

    it('enforces security headers and no-store on 404 response', async () => {
      const res = await fetch(`${server.baseUrl}/api/not-existing-endpoint`);
      assert.equal(res.status, 404);
      for (const [header, expected] of requiredSecurityHeaders) {
        assert.equal(res.headers.get(header), expected);
      }
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });
  });

  describe('500 Error Sanitization', () => {
    it('does not leak internal error message, stack trace or paths on 500 error', async () => {
      // Login as admin first
      const loginRes = await fetch(`${server.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: server.adminEmail, password: server.adminPassword })
      });
      assert.equal(loginRes.status, 200);
      const cookieHeader = loginRes.headers.get('set-cookie');

      // Corrupt the draft catalog JSON so GET /api/admin/catalog throws an unexpected (non-HTTP) error.
      const original = db.prepare("SELECT data FROM catalogs WHERE id='draft'").get().data;
      db.prepare("UPDATE catalogs SET data='{not json' WHERE id='draft'").run();
      let reportRes;
      try {
        reportRes = await fetch(`${server.baseUrl}/api/admin/catalog`, {
          headers: { 'Cookie': cookieHeader }
        });
      } finally {
        db.prepare("UPDATE catalogs SET data=? WHERE id='draft'").run(original);
      }
      assert.equal(reportRes.status, 500);

      const json = await reportRes.json();
      assert.equal(json.error, 'Có lỗi hệ thống. Vui lòng thử lại.');
      assert.equal(json.stack, undefined);
      assert.equal(json.message, undefined);

      // Verify security headers still present on 500
      assert.equal(reportRes.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(reportRes.headers.get('x-frame-options'), 'DENY');
      assert.equal(reportRes.headers.get('cache-control'), 'no-store');
    });
  });
});

