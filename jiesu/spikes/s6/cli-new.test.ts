/**
 * S6 · CLI 的 `jiesu new`：用户真的跑一遍这条路。
 *
 * 打包产物必须能跑通"创建项目"这件最基础的事——
 * 上一个版本就出现过 `npx jiesu` 从来没启动成功（shebang 写了两遍）却 129 个测试全绿的事故，
 * 教训是：**发布形态必须有真跑产物的测试**。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(HERE, '.sandbox-cli');
const BIN = join(HERE, '..', '..', 'dist', 'cli', 'bin.js');

function clean(): void {
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 沙箱已 gitignore */
  }
}

describe('S6 · jiesu new（真实跑打包产物）', () => {
  afterAll(clean);

  it('jiesu new my-page：生成项目并返回 0', () => {
    clean();
    mkdirSync(SANDBOX, { recursive: true });

    const stdout = execFileSync(process.execPath, [BIN, 'new', 'my-page', '--title', '我的页面'], {
      cwd: SANDBOX,
      encoding: 'utf8',
    });

    expect(stdout).toContain('创建项目');
    const root = join(SANDBOX, 'my-page');
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('<title>我的页面</title>');
  });

  it('不传名字时用默认名，而不是报错', () => {
    clean();
    mkdirSync(SANDBOX, { recursive: true });
    execFileSync(process.execPath, [BIN, 'new'], { cwd: SANDBOX, encoding: 'utf8' });
    expect(existsSync(join(SANDBOX, 'jiesu-app', 'vite.config.ts'))).toBe(true);
  });

  it('目录已占用时退出码为 1，且说清原因', () => {
    clean();
    const root = join(SANDBOX, 'taken');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'existing.txt'), '原有内容', 'utf8');

    let error: { status?: number; stderr?: string } | null = null;
    try {
      execFileSync(process.execPath, [BIN, 'new', 'taken'], {
        cwd: SANDBOX,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (caught) {
      error = caught as { status?: number; stderr?: string };
    }

    expect(error).not.toBeNull();
    expect(error!.status).toBe(1);
    expect(String(error!.stderr)).toContain('不为空');
    // 原有内容一个字节都没动
    expect(readFileSync(join(root, 'existing.txt'), 'utf8')).toBe('原有内容');
    expect(existsSync(join(root, 'package.json'))).toBe(false);
  });
});
