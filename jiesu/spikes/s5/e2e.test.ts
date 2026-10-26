/**
 * S5 端到端：往真实页面插入一个节点，页面真的多出它，并且能选中它。
 *
 * 这是"自由画布"路线（A0）的成立性判据，必须全部为真：
 *  1. 插入只改源码里那一处，格式不乱
 *  2. Vite HMR 之后，新节点真的出现在 DOM 上，且带着源码位置属性
 *  3. 服务端回传的锚点能选中这个新节点（否则用户拖进来的东西立刻就"丢了"）
 *  4. 删除能把它干净地拿掉，且不留下空行
 *
 * 注意：本用例直接通过 WebSocket 驱动，因为 Studio 界面还不存在。
 * 走的就是 Studio 将来会走的那条链路（server → 内核 → 文件 → HMR → DOM）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startServer, type RunningServer } from '../../src/server/server';
import type { ServerMessage } from '../../src/server/protocol';
import { resetFromHead } from '../_shared/baseline';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PATH = join(DEMO, 'src', 'App.tsx');
const PORT = 5208;

const original = resetFromHead(APP_PATH);
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');
const read = (): string => readFileSync(APP_PATH, 'utf8');

const SNIPPET = '<button className="rounded-md bg-blue-600 px-4 py-2 text-white">新按钮</button>';

interface Locator {
  filePath: string;
  line: number;
  column: number;
  anchor?: string;
}

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 15000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** 从活着的 DOM 元素上读两个锚点——和客户端发送前做的事情一致。 */
function locatorOf(page: Page, selector: string): Promise<Locator> {
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`找不到 ${sel}`);
    const src = el.getAttribute('data-jiesu-src');
    const id = el.getAttribute('data-jiesu-id');
    if (!src) throw new Error(`${sel} 没有源码位置属性`);
    const parts = src.split(':');
    const filePath = parts.slice(0, parts.length - 2).join(':');
    return {
      filePath,
      line: Number(parts[parts.length - 2]),
      column: Number(parts[parts.length - 1]),
      anchor: id ? id.split('#')[1] : undefined,
    };
  }, selector);
}

describe('S5 · 插入节点（真实 Chrome + 真实文件 + HMR）', () => {
  let server: RunningServer;
  let vite: Awaited<ReturnType<typeof import('vite').createServer>>;
  let browser: Browser;
  let page: Page;
  let ws: WebSocket;
  const messages: ServerMessage[] = [];
  const consoleErrors: string[] = [];

  /** 发一条结构编辑并等 changeApplied。 */
  async function sendStructure(locator: Locator, op: unknown, summary: string) {
    const before = messages.length;
    ws.send(JSON.stringify({ type: 'requestStructure', payload: { locator, op, summary } }));
    const got = await waitFor(
      () => messages.slice(before).some((m) => m.type === 'changeApplied' || m.type === 'error'),
    );
    expect(got).toBe(true);
    const found = messages.slice(before).find((m) => m.type === 'changeApplied' || m.type === 'error');
    return found as Extract<ServerMessage, { type: 'changeApplied' }> | Extract<ServerMessage, { type: 'error' }>;
  }

  beforeAll(async () => {
    restore();
    server = await startServer({ projectRoot: DEMO, port: 0, host: '127.0.0.1' });
    mkdirSync(join(DEMO, '.jiesu'), { recursive: true });
    writeFileSync(
      join(DEMO, '.jiesu', 'server.json'),
      JSON.stringify({ port: server.port, host: server.host }),
      'utf8',
    );

    const { createServer } = await import('vite');
    vite = await createServer({
      root: DEMO,
      logLevel: 'error',
      cacheDir: join(DEMO, '.vite-cache'),
      server: { host: '127.0.0.1', port: PORT, strictPort: true },
    });
    await vite.listen();

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--no-proxy-server'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await page.keyboard.press('Alt+Shift+J');
    await page.waitForTimeout(300);

    ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
  }, 180_000);

  afterAll(async () => {
    ws?.close();
    await browser?.close();
    await vite?.close();
    await server?.close();
    restore();
  });

  it('插入后：源码里多出这一行，且只动这一处', async () => {
    const locator = await locatorOf(page, 'main > div > div:nth-of-type(1)');
    const result = await sendStructure(
      locator,
      { kind: 'insert', position: 'after', snippet: SNIPPET },
      '插入按钮',
    );

    expect(result.type).toBe('changeApplied');
    const updated = read();
    expect(updated).toContain(SNIPPET);
    // 缩进跟兄弟一致（demo 里"第一块"在 main>div 内，8 空格）
    expect(updated).toContain(`\n        ${SNIPPET}\n`);
    // 除了新增的一行，原文逐字节不变
    expect(updated.replace(`\n        ${SNIPPET}`, '')).toBe(original);
  }, 60_000);

  it('HMR 之后：新节点真的出现在 DOM 上，并带着源码位置', async () => {
    const appeared = await waitFor(() =>
      page.evaluate(() => document.body.textContent?.includes('新按钮') === true),
    );
    expect(appeared).toBe(true);

    const attrs = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button')).find((node) =>
        node.textContent?.includes('新按钮'),
      );
      return {
        src: el?.getAttribute('data-jiesu-src') ?? null,
        id: el?.getAttribute('data-jiesu-id') ?? null,
      };
    });
    expect(attrs.src).toContain('App.tsx');
    expect(attrs.id).toBeTruthy();
  }, 60_000);

  it('服务端回传的锚点能选中这个新节点（否则拖进来的东西立刻"丢了"）', async () => {
    const locator = await locatorOf(page, 'main > div > div:nth-of-type(2)');
    const result = await sendStructure(
      locator,
      { kind: 'insert', position: 'after', snippet: '<p className="text-sm text-slate-500">说明文字</p>' },
      '插入说明',
    );
    expect(result.type).toBe('changeApplied');
    if (result.type !== 'changeApplied') return;
    expect(result.payload.select?.anchor).toBeTruthy();

    const anchor = result.payload.select!.anchor;
    const found = await waitFor(() =>
      page.evaluate((a: string) => Boolean(document.querySelector(`[data-jiesu-id$="#${a}"]`)), anchor),
    );
    expect(found).toBe(true);

    // 用这个锚点走一次真实选中：点它 → 面板打开且指向同一处源码
    const selected = await page.evaluate((a: string) => {
      const el = document.querySelector(`[data-jiesu-id$="#${a}"]`);
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      return el?.textContent ?? null;
    }, anchor);
    expect(selected).toContain('说明文字');

    await page.waitForTimeout(300);
    const panel = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      return {
        open: Boolean(shadow?.querySelector('.jd-panel')?.classList.contains('on')),
        src: shadow?.querySelector('.jd-src')?.textContent ?? '',
      };
    });
    expect(panel.open).toBe(true);
    expect(panel.src).toContain('App.tsx');
  }, 60_000);

  it('删除：节点从页面和源码里一起消失，不留空行', async () => {
    const before = read();
    const locator = await locatorOf(page, 'main > div > p');
    const result = await sendStructure(locator, { kind: 'delete' }, '删除说明');
    expect(result.type).toBe('changeApplied');

    const updated = read();
    expect(updated).not.toContain('说明文字');
    expect(updated).not.toMatch(/\n\s*\n/);
    expect(updated.length).toBeLessThan(before.length);

    const gone = await waitFor(() =>
      page.evaluate(() => document.body.textContent?.includes('说明文字') === false),
    );
    expect(gone).toBe(true);
  }, 60_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter((text) => !text.includes('favicon') && !text.includes('404'));
    expect(real).toEqual([]);
  });
});
