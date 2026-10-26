/**
 * 打包冒烟测试：真的把构建产物跑起来。
 *
 * 为什么需要它：`npx jiesu` 曾经 100% 起不来，而所有单元测试都是绿的——
 * 因为 esbuild 的 banner 与源码里自带的 shebang 叠成了两行 #!，
 * Node 只认第一行，第二个 `#!` 直接语法错误。
 * 这类问题只有"真的执行一次产物"才能发现。
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..');
const BIN = join(PKG, 'dist', 'cli', 'bin.js');

let workDir = '';
let child: ChildProcess | null = null;

async function waitFor(fn: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe('打包产物 · 真的能跑', () => {
  beforeAll(() => {
    if (!existsSync(BIN)) {
      execFileSync('node', [join(PKG, 'scripts', 'build.mjs')], { cwd: PKG, stdio: 'ignore' });
    }
    workDir = mkdtempSync(join(tmpdir(), 'jiesu-cli-'));
  }, 60_000);

  afterAll(() => {
    child?.kill('SIGTERM');
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('可执行文件只有一行 shebang（两行会导致 Node 语法错误）', () => {
    const head = readFileSync(BIN, 'utf8').split('\n').slice(0, 3);
    expect(head[0]).toBe('#!/usr/bin/env node');
    expect(head.filter((line) => line.startsWith('#!'))).toHaveLength(1);
  });

  it('真跑起来：写出 server.json 并能握手 WebSocket', async () => {
    child = spawn('node', [BIN, '--root', workDir], { stdio: 'ignore' });
    const metaFile = join(workDir, '.jiesu', 'server.json');

    const started = await waitFor(() => existsSync(metaFile));
    expect(started).toBe(true);

    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { port: number; host: string };
    expect(meta.port).toBeGreaterThan(0);

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://${meta.host}:${meta.port}/ws`);
      socket.on('message', (raw) => {
        resolve(String(raw));
        socket.close();
      });
      socket.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket 握手超时')), 5000);
    });

    const parsed = JSON.parse(message) as { type: string; payload: { projectRoot: string } };
    expect(parsed.type).toBe('ready');
    expect(parsed.payload.projectRoot).toBe(workDir);
  }, 30_000);
});
