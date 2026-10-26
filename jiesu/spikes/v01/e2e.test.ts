/**
 * 端到端验证：用真实 Chrome 打开真实页面，用鼠标点一次，改一次真实源码。
 *
 * 覆盖完整链路：
 *   Vite 插件注入位置 → 覆盖层选中元素 → 属性面板改值 → 服务端写回真实文件
 *   → 变更篮记录 → 撤销恢复
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PATH = join(DEMO, 'src', 'App.tsx');

const original = readFileSync(APP_PATH, 'utf8');
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');

async function waitFor(fn: () => boolean, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe('V0.1 · 端到端（真实 Chrome + 真实文件）', () => {
  let server: RunningServer;
  let vite: Awaited<ReturnType<typeof import('vite').createServer>>;
  let browser: Browser;
  let page: import('playwright-core').Page;
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
      server: { host: '127.0.0.1', port: 5199, strictPort: true },
    });
    await vite.listen();

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      // 本机走本地代理，必须让浏览器直连 localhost，否则会被代理拦成 502
      args: ['--no-sandbox', '--no-proxy-server'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    rmSync(join(DEMO, '.jiesu'), { recursive: true, force: true });
    restore();
  });

  it('页面元素带上了源码位置', async () => {
    const srcAttr = await page.getAttribute('nav', 'data-jiesu-src');
    expect(srcAttr).toBeTruthy();
    expect(srcAttr).toContain('App.tsx');
  });

  it('覆盖层已注入（Shadow DOM）', async () => {
    const ready = await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      return Boolean(host && host.shadowRoot);
    });
    expect(ready).toBe(true);
  });

  it('端口已注入页面', async () => {
    const port = await page.evaluate(() => (globalThis as any).__JIESU_PORT__);
    expect(port).toBe(server.port);
  });

  it('Alt+Shift+J 进入选择模式', async () => {
    await page.keyboard.press('Alt+Shift+J');
    await page.waitForTimeout(200);
    const visible = await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      return Boolean(host?.shadowRoot?.querySelector('.jd-hint.on'));
    });
    expect(visible).toBe(true);
  });

  it('点击元素打开属性面板，并列出可编辑项', async () => {
    // 精确选中 nav 里的内层 flex 容器（直接派发事件，避免命中内部子元素）
    await page.evaluate(() => {
      const el = document.querySelector('nav > div');
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      const shadow = host?.shadowRoot;
      return {
        open: Boolean(shadow?.querySelector('.jd-panel')?.classList.contains('on')),
        src: shadow?.querySelector('.jd-src')?.textContent ?? '',
        rows: shadow?.querySelectorAll('.jd-row').length ?? 0,
        labels: Array.from(shadow?.querySelectorAll('.jd-row label') ?? []).map(
          (l) => l.textContent,
        ),
      };
    });
    expect(state.open).toBe(true);
    expect(state.src).toContain('App.tsx');
    expect(state.rows).toBeGreaterThan(0);
    // 内层容器是 flex：应当列出间距 / 排列方向 / 对齐
    expect(state.labels).toContain('间距');
    expect(state.labels).toContain('排列方向');
  });

  it('改一个数值 → 真实写回源码文件，其余代码一字不动', async () => {
    const handle = await page.evaluateHandle(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      const inputs = Array.from(
        host?.shadowRoot?.querySelectorAll('.jd-row input[type=number]') ?? [],
      );
      return inputs[0] ?? null;
    });
    const hasInput = await page.evaluate((el: any) => Boolean(el), handle);
    expect(hasInput).toBe(true);

    await page.evaluate((el: any) => {
      el.value = '48';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, handle);


    const written = await waitFor(() => readFileSync(APP_PATH, 'utf8') !== original);
    expect(written).toBe(true);

    const updated = readFileSync(APP_PATH, 'utf8');
    expect(updated).toContain('gap-12');
    // 其它类不受影响
    expect(updated).toContain('px-6');
    expect(updated).toContain('py-4');
    expect(updated.replace('gap-12', 'gap-3')).toBe(original);
  }, 60_000);

  it('变更篮记录了这次修改', async () => {
    const basket = await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      const shadow = host?.shadowRoot;
      return {
        count: shadow?.querySelectorAll('.jd-bitem').length ?? 0,
        title: shadow?.querySelector('.jd-bhead .jd-title')?.textContent ?? '',
      };
    });
    expect(basket.count).toBe(1);
    expect(basket.title).toContain('1');
  });

  it('撤销后文件恢复原样', async () => {
    await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      const undo = host?.shadowRoot?.querySelector('.jd-bitem .jd-btn');
      (undo as HTMLButtonElement | undefined)?.click();
    });
    const reverted = await waitFor(() => readFileSync(APP_PATH, 'utf8') === original);
    expect(reverted).toBe(true);
  }, 60_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter(
      (e) => !e.includes('404') && !e.includes('favicon') && !e.includes('Failed to load resource'),
    );
    expect(real).toEqual([]);
  });
});
