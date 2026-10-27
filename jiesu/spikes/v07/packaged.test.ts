/**
 * V0.6 · 打包产物冒烟：Studio 必须能在 `node dist/cli/bin.js` 里跑起来。
 *
 * 为什么单列一条：Studio 的 HTTP 处理被打进 CLI 产物，出现的问题在源码态永远看不到。
 * 实际踩到过——`studio/serve.ts` 静态 import esbuild，esbuild 是 CJS 包，
 * 打进 ESM 产物后加载期就抛 `Dynamic require of "fs" is not supported`，
 * 整个 CLI 直接启动失败，而当时所有测试都是绿的（它们都跑源码）。
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const SANDBOX = join(HERE, '.sandbox-cli');
const BIN = join(PKG, 'dist', 'cli', 'bin.js');

function clean(): void {
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 沙箱已 gitignore */
  }
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

describe('V0.6 · 打包产物里的 Studio', () => {
  afterAll(clean);

  it('node dist/cli/bin.js 起得来，且 /studio 与前端脚本都能取到', async () => {
    if (!existsSync(BIN)) {
      execFileSync('node', ['scripts/build.mjs'], { cwd: PKG, stdio: 'ignore' });
    }

    clean();
    mkdirSync(SANDBOX, { recursive: true });
    writeFileSync(join(SANDBOX, 'index.txt'), 'placeholder', 'utf8');

    const port = 5410;
    const proc = spawn(process.execPath, [BIN, '--root', SANDBOX, '--port', String(port)], {
      cwd: PKG,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    proc.stdout.on('data', (chunk) => output.push(String(chunk)));
    proc.stderr.on('data', (chunk) => output.push(String(chunk)));

    try {
      const up = await waitFor(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/studio`);
          return res.ok;
        } catch {
          return false;
        }
      });
      expect(up, `CLI 没起来，输出：\n${output.join('')}`).toBe(true);

      const html = await (await fetch(`http://127.0.0.1:${port}/studio`)).text();
      expect(html).toContain('界塑 · Studio');
      expect(html).toContain(`window.__JIESU_PORT__=${port}`);

      // 这一条是重点：前端脚本必须从 dist/studio/main.js 读到，不能靠现场编译 TS
      const js = await fetch(`http://127.0.0.1:${port}/studio/main.js`);
      expect(js.status).toBe(200);
      const code = await js.text();
      expect(code).toContain('api/changes');
      expect(code).toContain('device-switch');

      const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as {
        projectRoot: string;
      };
      expect(state.projectRoot).toBe(SANDBOX);
    } finally {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
        setTimeout(resolve, 5000);
      });
    }
  }, 120_000);
});
