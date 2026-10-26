/**
 * 端到端验证 V0.2 拖拽重排：真实 Chrome 里用鼠标拖一次，真实源码里的节点顺序改变。
 *
 * 关键命题（这是与"拖到哪写 left/top"那类编辑器最本质的区别）：
 *   拖动改变的是**代码里的节点顺序**，不是任何定位属性。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLayoutSafety } from '../../src/core/layout/guard';
import { startServer, type RunningServer } from '../../src/server/server';
import { resetFromHead } from '../_shared/baseline';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PATH = join(DEMO, 'src', 'App.tsx');

// 基线从 git HEAD 取：避免上次运行的脏文件 / 用户在演示里的拖动污染断言
const original = resetFromHead(APP_PATH);
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');
const read = (): string => readFileSync(APP_PATH, 'utf8');

async function waitFor(fn: () => boolean, timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((res) => setTimeout(res, 100));
  }
  return false;
}

/** 在页面上选一个元素（直接派发 click，避免命中内部子元素）。 */
async function select(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    document
      .querySelector(sel)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }, selector);
  await page.waitForTimeout(250);
}

async function center(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} 没有布局盒模型`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 真实鼠标拖拽：按住 → 分步移动 → 松开。 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // 先越过 5px 阈值，让覆盖层进入拖拽态
  await page.mouse.move(from.x + 10, from.y, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

const panelState = (page: Page) =>
  page.evaluate(() => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    return {
      open: Boolean(shadow?.querySelector('.jd-panel')?.classList.contains('on')),
      src: shadow?.querySelector('.jd-src')?.textContent ?? '',
      tip: shadow?.querySelector('.jd-tip')?.textContent ?? '',
      toast: shadow?.querySelector('.jd-toast')?.textContent ?? '',
      basket: shadow?.querySelectorAll('.jd-bitem').length ?? 0,
      summary: shadow?.querySelector('.jd-bitem .jd-sum div')?.textContent ?? '',
      dropShown: (shadow?.querySelector('.jd-drop') as HTMLElement | null)?.style.display ?? 'none',
    };
  });

describe('V0.2 · 拖拽重排（真实 Chrome + 真实文件）', () => {
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
      // 各 demo 独立缓存目录：多个 e2e 并行跑时会抢同一个 .vite 缓存
      cacheDir: join(DEMO, '.vite-cache'),
      server: { host: '127.0.0.1', port: 5202, strictPort: true },
    });
    await vite.listen();

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      // 本机走本地代理，必须让浏览器直连 localhost
      args: ['--no-sandbox', '--no-proxy-server'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto('http://127.0.0.1:5202/', { waitUntil: 'networkidle' });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    rmSync(join(DEMO, '.jiesu'), { recursive: true, force: true });
    restore();
  });

  it('页面元素带源码位置，覆盖层已注入', async () => {
    expect(await page.getAttribute('h1', 'data-jiesu-src')).toContain('App.tsx');
    const ok = await page.evaluate(() =>
      Boolean(document.querySelector('[data-jiesu-overlay]')?.shadowRoot),
    );
    expect(ok).toBe(true);
  });

  it('Alt+Shift+J 进入选择模式', async () => {
    await page.keyboard.press('Alt+Shift+J');
    await page.waitForTimeout(200);
    const on = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      return Boolean(shadow?.querySelector('.jd-hint.on'));
    });
    expect(on).toBe(true);
  });

  it('选中卡片后面板给出拖拽提示', async () => {
    await select(page, '.flex > div:nth-child(1)');
    const state = await panelState(page);
    expect(state.open).toBe(true);
    // V0.4 起默认拖 = 位移，Shift+拖 = 调顺序，提示里必须写清楚
    expect(state.tip).toContain('跟着鼠标移动');
    expect(state.tip).toContain('Shift');
  });

  it('Shift+拖动第一张到最后 → 源码里节点顺序真的变了', async () => {
    const from = await center(page, '.flex > div:nth-child(1)');
    const last = await center(page, '.flex > div:nth-child(3)');

    await page.keyboard.down('Shift');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y, { steps: 2 });
    // 拖到第三张右半部分之外，确保插入位置是"最末"
    await page.mouse.move(last.x + 120, last.y, { steps: 12 });

    // 拖拽过程中必须能看到插入指示线（否则用户不知道会插到哪）
    const mid = await panelState(page);
    expect(mid.dropShown).toBe('block');

    await page.mouse.up();
    await page.keyboard.up('Shift');

    const changed = await waitFor(() => read() !== original);
    expect(changed).toBe(true);

    const updated = read();
    const a = updated.indexOf('第一张');
    const b = updated.indexOf('第二张');
    const c = updated.indexOf('第三张');
    expect(b).toBeGreaterThan(-1);
    // 新顺序：第二张 → 第三张 → 第一张
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(a);
  }, 60_000);

  it('产物里没有任何绝对定位，缩进与结构原样保留', () => {
    const updated = read();
    const audit = auditLayoutSafety(updated);
    expect(audit.violations).toEqual([]);
    expect(updated).not.toMatch(/\b(absolute|fixed)\b/);
    // 没有靠 order-N 类"假装"换了顺序
    expect(updated).not.toMatch(/\border-\d/);
    // 每张卡片仍然各占一行、缩进 8 空格（空白段固定不动）
    const cardLines = updated
      .split('\n')
      .filter((line) => line.trimStart().startsWith('<div') && line.includes('w-40'));
    expect(cardLines).toHaveLength(3);
    for (const line of cardLines) {
      expect(line.length - line.trimStart().length).toBe(8);
    }
  });

  it('变更篮记录了一条"调整顺序"的变更', async () => {
    const state = await panelState(page);
    expect(state.basket).toBe(1);
    expect(state.summary).toContain('调整顺序');
  }, 30_000);

  it('拖拽后选中态没有丢（面板仍开着，且指向 App.tsx）', async () => {
    await page.waitForTimeout(800);
    const state = await panelState(page);
    expect(state.open).toBe(true);
    expect(state.src).toContain('App.tsx');
  }, 30_000);

  it('撤销后文件恢复原样', async () => {
    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      (shadow?.querySelector('.jd-bitem .jd-btn') as HTMLButtonElement | undefined)?.click();
    });
    const reverted = await waitFor(() => read() === original);
    expect(reverted).toBe(true);
  }, 60_000);

  it('父容器不是 flex/grid 时，Shift+拖动明确拒绝重排（而不是硬改）', async () => {
    await page.waitForTimeout(500);
    await select(page, 'h1');
    const from = await center(page, 'h1');
    await page.keyboard.down('Shift');
    await drag(page, from, { x: from.x + 160, y: from.y });
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    const state = await panelState(page);
    expect(state.toast).toContain('暂不支持拖拽重排');
    expect(read()).toBe(original);
  }, 60_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter(
      (e) => !e.includes('404') && !e.includes('favicon') && !e.includes('Failed to load resource'),
    );
    expect(real).toEqual([]);
  });
});
