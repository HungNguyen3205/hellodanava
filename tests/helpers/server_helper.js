import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT_DIR = resolve('.');
const SERVER_PATH = resolve(ROOT_DIR, 'backend/server.js');

export async function startServer({
  port = 3991,
  adminEmail = 'qa-admin@test.local',
  adminPassword = 'qa-super-secret-password-16char',
  secureCookies = '0',
  dataDir = null,
  args = [],
  env = {},
  inheritPassword = true
} = {}) {
  const tempDir = dataDir || mkdtempSync(join(tmpdir(), `danava-qa-${port}-`));
  const serverEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: tempDir,
    SECURE_COOKIES: secureCookies,
    ...env
  };

  if (adminEmail !== undefined) {
    serverEnv.ADMIN_EMAIL = adminEmail;
  } else {
    delete serverEnv.ADMIN_EMAIL;
  }

  if (inheritPassword && adminPassword !== undefined) {
    serverEnv.ADMIN_PASSWORD = adminPassword;
  } else if (!inheritPassword) {
    delete serverEnv.ADMIN_PASSWORD;
  }

  const proc = spawn(process.execPath, [SERVER_PATH, ...args], {
    cwd: ROOT_DIR,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  const readyPromise = new Promise((resolveReady, rejectReady) => {
    const onData = (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (chunk.includes('Hello DANAVA · cổng ' + port)) {
        proc.stdout.off('data', onData);
        resolveReady();
      }
    };
    proc.stdout.on('data', onData);

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      rejectReady(new Error(`Failed to spawn server on port ${port}: ${err.message}`));
    });

    proc.on('exit', (code, signal) => {
      rejectReady(new Error(`Server on port ${port} exited prematurely with code ${code}, signal ${signal}. Stderr: ${stderr}`));
    });
  });

  const timerPromise = new Promise((_, rejectTimeout) =>
    setTimeout(() => rejectTimeout(new Error(`Server startup timeout on port ${port}. Stdout: ${stdout}, Stderr: ${stderr}`)), 5000)
  );

  await Promise.race([readyPromise, timerPromise]);

  async function stop() {
    if (proc.exitCode === null && proc.signalCode === null) {
      await new Promise((res) => {
        proc.once('exit', () => res());
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
          }
        }, 1000);
      });
    }
    // Clean up tempDir if we created it
    if (!dataDir) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  }

  function getDb() {
    return new DatabaseSync(join(tempDir, 'studio.sqlite'));
  }

  return {
    proc,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    tempDir,
    adminEmail,
    adminPassword,
    getDb,
    stop
  };
}

