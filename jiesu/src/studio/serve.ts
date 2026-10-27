import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';

import { EditError } from '../server/session.js';
import { renderShell } from './shell.js';

export interface StudioContext {
  projectRoot: string;
  port: number;
  changes: () => unknown[];
  undo: (changeId: string) => void;
}

const MAX_BODY = 64 * 1024;

let studioBundle: string | null = null;

/**
 * 取 Studio 前端脚本。
 *
 * 为什么要有候选路径：这个文件会被打进 `dist/cli/bin.js`，
 * 那时 `import.meta.url` 指向 `dist/cli/bin.js`，相对路径就找不到产物了。
 * 所以按顺序试：
 *   1. 与本文件同级（`dist/studio/serve.js` 单独打包的形态 / `src/studio/serve.ts`）
 *   2. 包根相对（`dist/cli/bin.js` → `dist/studio/main.js`）
 *   3. 都没有就从 TS 源码现场编译（只有从 src 跑时可行）
 */
async function loadStudioBundle(): Promise<string> {
  if (studioBundle !== null) return studioBundle;

  const candidates = [new URL('./main.js', import.meta.url).pathname];
  const binPath = process.argv[1];
  if (binPath) candidates.push(join(dirname(binPath), '..', 'studio', 'main.js'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      studioBundle = readFileSync(candidate, 'utf8');
      return studioBundle;
    }
  }

  // 动态引入：esbuild 是 CJS 包，被打进 ESM 产物后它的 require('fs') 会在加载期就抛
  // （"Dynamic require of fs is not supported"）。发布形态下 dist/studio/main.js 一定存在，
  // 这里只是从源码跑（vitest / tsx）时的兜底路径。
  const { buildSync } = await import('esbuild');
  const result = buildSync({
    entryPoints: [new URL('./main.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
  });
  studioBundle = result.outputFiles[0].text;
  return studioBundle;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new EditError('请求体过大', `${size} bytes`);
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * 处理 Studio 与 /api/* 请求。
 * 返回 false 表示"不是我管的"，交回调用方（例如 /health）。
 */
export async function handleStudioRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioContext,
): Promise<boolean> {
  const url = req.url ?? '/';
  const path = url.split('?')[0].replace(/\/+$/, '') || '/';

  if (path === '/studio' || path === '/') {
    const html = renderShell().replace(
      '</head>',
      `<script>window.__JIESU_PORT__=${ctx.port};</script></head>`,
    );
    send(res, 200, 'text/html; charset=utf-8', html);
    return true;
  }

  if (path === '/studio/main.js') {
    send(res, 200, 'text/javascript; charset=utf-8', await loadStudioBundle());
    return true;
  }

  if (path === '/api/state') {
    sendJson(res, 200, {
      projectRoot: ctx.projectRoot,
      port: ctx.port,
      changes: (ctx.changes() as unknown[]).length,
    });
    return true;
  }

  if (path === '/api/changes' && req.method === 'GET') {
    sendJson(res, 200, { changes: ctx.changes() });
    return true;
  }

  if (path === '/api/undo' && req.method === 'POST') {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, message: `请求体不是合法 JSON：${String(error)}` });
      return true;
    }
    const changeId = (body as { changeId?: unknown })?.changeId;
    if (typeof changeId !== 'string' || changeId.length === 0) {
      sendJson(res, 400, { ok: false, message: '缺少 changeId' });
      return true;
    }
    try {
      ctx.undo(changeId);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { ok: false, message });
    }
    return true;
  }

  // /api/* 下未实现的路径要明确 404，不能落到静态兜底上
  if (path.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, message: `没有这个接口：${path}` });
    return true;
  }

  return false;
}
