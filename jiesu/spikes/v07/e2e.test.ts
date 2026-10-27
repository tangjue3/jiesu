/**
 * V0.6 Studio · 浏览器里的壳
 *
 * 验证 02 画布页与 07 代码页真的能用：
 *  - 画布 iframe 载入真实页面（不是占位图）
 *  - 三设备切换改的是 iframe 的真实宽度
 *  - 代码页列出真实改动、显示 diff、撤销能把文件改回去
 *  - 未实现的页面诚实标"即将上线"，不做假界面
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';
import { resetFromHead } from '../_shared/baseline';
import { locateByClassToken } from '../_shared/jsx-fixture';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const APP_PATH = join(DEMO, 'src', 'App.tsx');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VITE_PORT = 5210;

const original = resetFromHead(APP_PATH);
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');
const read = (): string => readFileSync(APP_PATH, 'utf8');

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

describe('V0.6 · Studio 壳（真实 Chrome）', () => {
  let server: RunningServer;
  let vite: Awaited<ReturnType<typeof import('vite').createServer>>;
  let browser: Browser;
  let page: Page;
  const consoleErrors: string[] = [];

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
      server: { host: '127.0.0.1', port: VITE_PORT, strictPort: true },
    });
    await vite.listen();

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--no-proxy-server'],
    });
    page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(`http://127.0.0.1:${server.port}/studio?url=http://127.0.0.1:${VITE_PORT}/`, {
      waitUntil: 'networkidle',
    });
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    restore();
  });

  it('壳的骨架与导航与参考一致', async () => {
    const rail = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-nav]'));
      return items.map((item) => item.textContent?.trim());
    });
    expect(rail).toEqual(['首页', '项目', '画布', '组件', '样式', '适配', 'AI', '代码', '设置']);

    // 左导航 72px、顶栏 60px 是参考文档的硬要求
    const size = await page.evaluate(() => {
      const nav = document.querySelector('.rail');
      const top = document.querySelector('.topbar');
      return {
        rail: nav ? Math.round(nav.getBoundingClientRect().width) : 0,
        top: top ? Math.round(top.getBoundingClientRect().height) : 0,
      };
    });
    expect(size.rail).toBe(72);
    expect(size.top).toBe(60);
  });

  it('画布真的把页面载进来了', async () => {
    const canvas = page.frameLocator('#canvas-frame');
    const loaded = await waitFor(async () => (await canvas.locator('h1').count()) > 0);
    expect(loaded).toBe(true);

    // 注意用 frameLocator：page.frame({url}) 会连主框架一起匹配上（Studio 的地址里就含 ?url=...）
    expect(await canvas.locator('h1').textContent()).toContain('Studio 画布');
    expect(await canvas.locator('h2').textContent()).toContain('这一块可以改');
  });

  it('三设备切换改的是 iframe 的真实宽度', async () => {
    const widthOf = () =>
      page.evaluate(() => {
        const frame = document.querySelector('#frame') as HTMLElement | null;
        return frame ? Math.round(frame.getBoundingClientRect().width) : 0;
      });

    // 桌面画板是自适应的：不超过 1440，也不该窄到装不下内容
    const desktop = await widthOf();
    expect(desktop).toBeGreaterThan(1000);
    expect(desktop).toBeLessThanOrEqual(1440);
    expect(await page.textContent('#frame-label')).toContain('自适应');

    await page.click('[data-device="mobile"]');
    await page.waitForTimeout(200);
    expect(await widthOf()).toBe(390);
    const label = await page.textContent('#frame-label');
    expect(label).toContain('手机');

    await page.click('[data-device="tablet"]');
    await page.waitForTimeout(200);
    expect(await widthOf()).toBe(834);
  });

  it('代码页：真实改动 + diff + 撤销', async () => {
    // 直接走会话改一次（等价于在画布里点一下改间距）
    const locator = { ...locateByClassToken(original, 'p-6'), filePath: 'src/App.tsx' };
    server.session.applyStyleChange(
      locator,
      { kind: 'classByPx', category: 'spacing', prefix: 'p', fromPx: 24, toPx: 32 },
      '内边距 24px → 32px',
    );
    expect(read()).toContain('p-8');

    await page.click('[data-nav="code"]');
    await page.waitForSelector('.change');

    const summary = await page.textContent('.change .sum');
    expect(summary).toContain('内边距');
    expect(await page.textContent('#change-count')).toContain('1 条');

    // diff 必须同时有减号和加号行（这样才看得出改了什么）
    const diff = await page.textContent('#diff-view');
    expect(diff).toContain('- ');
    expect(diff).toContain('+ ');
    expect(diff).toContain('p-8');

    await page.click('#undo-btn');
    const restored = await waitFor(() => read() === original);
    expect(restored).toBe(true);
    // 撤销走的是 WebSocket 广播：文件恢复与 Studio 收到通知是两件事，
    // 只等文件会让断言偶发抢在页面刷新之前。这里等 Studio 真的显示"空"。
    const emptied = await waitFor(async () => {
      const text = await page.textContent('#change-count');
      return Boolean(text?.includes('空'));
    });
    expect(emptied, `撤销后变更篮未清空，当前显示：${await page.textContent('#change-count')}`).toBe(
      true,
    );
    expect(await page.textContent('#change-count')).toContain('空');
  });

  it('未实现的页面诚实占位，不做假界面', async () => {
    await page.click('[data-nav="ai"]');
    await page.waitForTimeout(150);
    expect(await page.textContent('#todo-title')).toContain('即将上线');
    expect(await page.textContent('#page-sub')).toContain('即将上线');
  });

  it('地址不合法时给明确原因，不乱打开', async () => {
    await page.click('[data-nav="canvas"]');
    await page.fill('#url-input', 'localhost:5173');
    await page.click('#open-btn');
    await page.waitForTimeout(150);

    const toast = await page.evaluate(
      () => document.getElementById('studio-toast')?.textContent ?? '',
    );
    expect(toast).toContain('http://');
  });

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter((text) => !text.includes('favicon') && !text.includes('404'));
    expect(real).toEqual([]);
  });
});
