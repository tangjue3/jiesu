/**
 * V0.6 Studio · HTTP 层
 *
 * 只测服务端：Shell 页面、前端脚本、三个 API、撤销真的把文件改回去。
 * 浏览器里的交互在 e2e.test.ts。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';
import { resetFromHead } from '../_shared/baseline';
import { locateByClassToken } from '../_shared/jsx-fixture';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const APP_PATH = join(DEMO, 'src', 'App.tsx');

const original = resetFromHead(APP_PATH);
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');
const read = (): string => readFileSync(APP_PATH, 'utf8');

describe('V0.6 · Studio HTTP', () => {
  let server: RunningServer;
  let base = '';

  beforeAll(async () => {
    restore();
    server = await startServer({ projectRoot: DEMO, port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server?.close();
    restore();
  });

  it('GET /studio 返回壳：导航齐全、令牌正确、注入端口', async () => {
    const res = await fetch(`${base}/studio`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    // 八个导航项 + 设置
    for (const label of ['首页', '项目', '画布', '组件', '样式', '适配', 'AI', '代码', '设置']) {
      expect(html).toContain(`>${label}<`);
    }
    // 设计令牌（参考 V2 的硬要求）
    expect(html).toContain('#F7F9FC');
    expect(html).toContain('#5276F5');
    expect(html).toContain('--rail: 72px');
    expect(html).toContain('--topbar: 60px');
    // 端口注入：Studio 自己也要连服务
    expect(html).toContain(`window.__JIESU_PORT__=${server.port}`);
    // 三设备切换
    for (const device of ['desktop', 'tablet', 'mobile']) {
      expect(html).toContain(`data-device="${device}"`);
    }
  });

  it('GET /studio/main.js 返回可执行的前端脚本', async () => {
    const res = await fetch(`${base}/studio/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');

    const code = await res.text();
    expect(code.length).toBeGreaterThan(1000);
    // 关键行为都在里面（否则页面打开是死的）
    expect(code).toContain('api/changes');
    expect(code).toContain('api/undo');
    expect(code).toContain('device-switch');
    expect(code).toContain('Alt+Shift+J');
  });

  it('GET /api/state 报告项目与变更数', async () => {
    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { projectRoot: string; port: number; changes: number };
    expect(data.projectRoot).toBe(DEMO);
    expect(data.port).toBe(server.port);
    expect(data.changes).toBe(0);
  });

  it('改一次 → /api/changes 有记录；/api/undo 把文件还原', async () => {
    const locator = { ...locateByClassToken(original, 'p-6'), filePath: 'src/App.tsx' };
    server.session.applyStyleChange(
      locator,
      { kind: 'classByPx', category: 'spacing', prefix: 'p', fromPx: 24, toPx: 32 },
      '内边距 24px → 32px',
    );
    expect(read()).toContain('p-8');

    const listRes = await fetch(`${base}/api/changes`);
    const list = (await listRes.json()) as {
      changes: Array<{ id: string; summary: string; filePath: string; diff: { before: string; after: string } }>;
    };
    expect(list.changes).toHaveLength(1);
    expect(list.changes[0].summary).toContain('内边距');
    expect(list.changes[0].filePath).toBe('src/App.tsx');
    // 代码页要靠 diff 显示改了哪一行
    expect(list.changes[0].diff.before.length).toBeGreaterThan(0);
    expect(list.changes[0].diff.after.length).toBeGreaterThan(0);

    const undone = await fetch(`${base}/api/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changeId: list.changes[0].id }),
    });
    expect(undone.status).toBe(200);
    expect(await undone.json()).toEqual({ ok: true });
    expect(read()).toBe(original);

    const after = (await (await fetch(`${base}/api/changes`)).json()) as { changes: unknown[] };
    expect(after.changes).toHaveLength(0);
  });

  it('撤销不存在 / 缺参数：400 且说清原因', async () => {
    const missing = await fetch(`${base}/api/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { message: string }).message).toContain('changeId');

    const unknown = await fetch(`${base}/api/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changeId: 'chg_999' }),
    });
    expect(unknown.status).toBe(400);
  });

  it('未实现的 /api 路径返回 404 JSON，而不是落到静态兜底', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    const data = (await res.json()) as { ok: boolean; message: string };
    expect(data.ok).toBe(false);
    expect(data.message).toContain('/api/nope');
  });

  it('/health 仍然可用（没被 Studio 抢走）', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; projectRoot: string };
    expect(data.ok).toBe(true);
    expect(data.projectRoot).toBe(DEMO);
  });
});
