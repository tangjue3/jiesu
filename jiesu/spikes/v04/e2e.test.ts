/**
 * V0.4 端到端：元素真的跟着鼠标走，但代码里只有一个语义化的位移类。
 *
 * 关键命题（与"拖到哪写 left/top"那类编辑器的分界）：
 *  1. 拖动过程中元素跟手（内联预览，不写文件）
 *  2. 松手后源码里只多一个 `translate-x-N`，没有任何坐标
 *  3. 预览用的内联 transform 事后会被清掉，不残留在页面上
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
const BUTTON = 'button';

async function waitFor(fn: () => boolean, timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

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

const overlayState = (page: Page) =>
  page.evaluate(() => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    return {
      label: (shadow?.querySelector('.jd-move') as HTMLElement | null)?.textContent ?? '',
      labelShown: (shadow?.querySelector('.jd-move') as HTMLElement | null)?.style.display ?? 'none',
      toast: shadow?.querySelector('.jd-toast')?.textContent ?? '',
      inlineTransform:
        (document.querySelector('button') as HTMLElement | null)?.style.transform ?? '',
      moveX:
        (shadow?.querySelector('input[data-jd-move="x"]') as HTMLInputElement | null)?.value ?? '',
      moveY:
        (shadow?.querySelector('input[data-jd-move="y"]') as HTMLInputElement | null)?.value ?? '',
    };
  });

describe('V0.4 · 拖动位移（真实 Chrome + 真实文件）', () => {
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
      server: { host: '127.0.0.1', port: 5207, strictPort: true },
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

    await page.goto('http://127.0.0.1:5207/', { waitUntil: 'networkidle' });
    await page.keyboard.press('Alt+Shift+J');
    await page.waitForTimeout(200);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    rmSync(join(DEMO, '.jiesu'), { recursive: true, force: true });
    restore();
  });

  it('拖动过程中：元素跟手，并显示 X / Y 数值', async () => {
    await select(page, BUTTON);
    const from = await center(page, BUTTON);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 8, { steps: 6 });
    await page.mouse.move(from.x + 40, from.y + 12, { steps: 6 });

    const mid = await overlayState(page);
    // 元素真的动了（内联预览，此时文件还没改）
    expect(mid.inlineTransform).toContain('translate3d');
    expect(mid.inlineTransform).toContain('40px');
    // 吸附到 4px 刻度：12 → 12（正好是 4 的倍数）
    expect(mid.label).toContain('X +40');
    expect(mid.label).toContain('Y +12');
    expect(mid.labelShown).toBe('block');
    expect(read()).toBe(original);

    await page.mouse.up();
  }, 60_000);

  it('松手后：源码里只多一个位移类，没有任何坐标', async () => {
    const changed = await waitFor(() => read() !== original);
    expect(changed).toBe(true);

    const updated = read();
    expect(updated).toContain('translate-x-10'); // 40px / 4
    expect(updated).toContain('translate-y-3'); // 12px / 4
    // 除了追加的两个类，其余一字未动
    expect(updated.replace(' translate-x-10 translate-y-3', '')).toBe(original);

    const audit = auditLayoutSafety(updated);
    expect(audit.violations).toEqual([]);
    expect(updated).not.toMatch(/\b(absolute|fixed)\b/);
    expect(updated).not.toMatch(/\b(position|left|right|top|inset)\s*:/);
  }, 60_000);

  it('HMR 之后内联预览被清掉，位移由 class 承担', async () => {
    // 等 class 生效 + settlePendingMove
    await page.waitForTimeout(1200);

    const state = await overlayState(page);
    expect(state.inlineTransform).toBe('');

    // 元素视觉上仍在位移后的位置。
    // 注意 Tailwind v4 的 translate-x-* 写的是 CSS `translate` 属性，
    // v3 写的是 `transform` —— 两者都要认。
    const shifted = await page.evaluate(() => {
      const el = document.querySelector('button') as HTMLElement;
      const style = getComputedStyle(el);
      return { translate: style.translate, transform: style.transform };
    });
    expect(shifted.translate !== 'none' || shifted.transform !== 'none').toBe(true);
  }, 60_000);

  it('属性面板显示当前位移', async () => {
    const state = await overlayState(page);
    expect(state.moveX).toBe('40');
    expect(state.moveY).toBe('12');
  });

  it('点「复位」→ 位移类被删掉，文件回到原样', async () => {
    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const buttons = Array.from(shadow?.querySelectorAll<HTMLButtonElement>('.jd-btn') ?? []);
      const reset = buttons.find((b) => b.textContent === '复位');
      if (!reset) throw new Error('找不到复位按钮');
      reset.click();
    });

    const reverted = await waitFor(() => read() === original);
    expect(reverted).toBe(true);
  }, 60_000);

  it('Esc 取消拖拽：文件一个字都不改', async () => {
    await page.waitForTimeout(800);
    const before = read();
    const from = await center(page, BUTTON);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(400);

    const state = await overlayState(page);
    expect(state.toast).toContain('已取消位移');
    expect(state.inlineTransform).toBe('');
    expect(read()).toBe(before);
  }, 60_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter(
      (e) => !e.includes('404') && !e.includes('favicon') && !e.includes('Failed to load resource'),
    );
    expect(real).toEqual([]);
  });
});
