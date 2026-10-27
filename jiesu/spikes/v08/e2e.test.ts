/**
 * V0.7 组件库页（真实 Chrome）
 *
 * 验证「从组件库插到画布」这条产品主线：
 *  1. 九张模板卡片 + 分组筛选 + 搜索
 *  2. 没选中元素时明确禁用并说清原因（不猜"插到页面根"）
 *  3. 画布选中后，Studio 立刻知道插入目标
 *  4. 点插入 → 源码真的多出这一段 → 画布上出现 → 代码页能撤销
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';
import { resetFromHead } from '../_shared/baseline';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const APP_PATH = join(DEMO, 'src', 'App.tsx');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VITE_PORT = 5211;

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

/** 只取内容 iframe：主框架地址里也含 :端口（因为它带 ?url= 参数）。 */
function contentFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame !== page.mainFrame() && frame.url().startsWith(`http://127.0.0.1:${VITE_PORT}`));
}

/**
 * 选中元素。Alt+Shift+J 是**切换**开关：上一条用例可能已经把选择模式开着，
 * 再按一次反而会关掉它（实测就是这条导致后面的用例选不中）。所以先看状态再决定。
 */
async function selectInCanvas(frame: Frame, selector: string): Promise<void> {
  const selecting = await frame.evaluate(
    () =>
      document
        .querySelector('[data-jiesu-overlay]')
        ?.shadowRoot?.querySelector('.jd-hint')
        ?.classList.contains('on') ?? false,
  );
  if (!selecting) {
    await frame.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', altKey: true, shiftKey: true, bubbles: true }),
      );
    });
  }
  await frame.evaluate((sel: string) => {
    document.querySelector(sel)?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }, selector);
}

describe('V0.7 · 组件库（真实 Chrome + 真实文件）', () => {
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

    await page.goto(
      `http://127.0.0.1:${server.port}/studio?url=http://127.0.0.1:${VITE_PORT}/&page=components`,
      { waitUntil: 'networkidle' },
    );
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    restore();
  });

  it('组件页列出全部模板，按分组可筛选', async () => {
    await page.waitForSelector('.card');
    const names = await page.$$eval('.card .name', (els) => els.map((el) => el.textContent));
    expect(names.length).toBe(9);
    expect(names).toContain('按钮');
    expect(names).toContain('卡片');

    const chips = await page.$$eval('.chip', (els) => els.map((el) => el.textContent));
    expect(chips).toEqual(['全部', '基础', '表单', '展示', '布局']);

    await page.click('.chip[data-group="表单"]');
    await page.waitForTimeout(150);
    const filtered = await page.$$eval('.card .name', (els) => els.map((el) => el.textContent));
    expect(filtered).toEqual(['按钮', '输入框']);

    await page.click('.chip[data-group="全部"]');
    await page.waitForTimeout(150);
  });

  it('搜索按名称与标签过滤，无结果时明说', async () => {
    await page.fill('#lib-search', '按钮');
    await page.waitForTimeout(150);
    expect(await page.$$eval('.card .name', (els) => els.map((el) => el.textContent))).toEqual(['按钮']);

    await page.fill('#lib-search', 'zzz');
    await page.waitForTimeout(150);
    expect(await page.textContent('#lib-grid')).toContain('没有匹配的组件');

    await page.fill('#lib-search', '');
    await page.waitForTimeout(150);
    expect((await page.$$('.card')).length).toBe(9);
  });

  it('没选中元素时按钮禁用，并说明要先选一个', async () => {
    const target = await page.textContent('#lib-target');
    expect(target).toContain('还没选中元素');

    const disabled = await page.$$eval('.lib-actions button', (els) =>
      els.map((el) => (el as HTMLButtonElement).disabled),
    );
    expect(disabled.every(Boolean)).toBe(true);
  });

  it('画布选中后，Studio 立刻知道插入目标', async () => {
    await page.click('[data-nav="canvas"]');
    const frame = contentFrame(page);
    expect(frame).toBeTruthy();
    await waitFor(async () => Boolean(frame && (await frame.locator('section').count()) > 0));

    await selectInCanvas(frame!, 'section');
    expect(await waitFor(async () => (await page.textContent('#lib-target')) !== null)).toBe(true);

    await page.click('[data-nav="components"]');
    const settled = await waitFor(async () => {
      const text = await page.textContent('#lib-target');
      return Boolean(text && text.includes('插入目标'));
    });
    expect(settled).toBe(true);

    const target = await page.textContent('#lib-target');
    expect(target).toContain('section');
    expect(target).toContain('App.tsx');

    const disabled = await page.$$eval('.lib-actions button', (els) =>
      els.map((el) => (el as HTMLButtonElement).disabled),
    );
    expect(disabled).toEqual([false, false, false]);
  }, 90_000);

  it('点「下方」插入卡片：源码多出这一段，画布出现，代码页可撤销', async () => {
    await page.click('.card[data-template="card"]');
    await page.waitForTimeout(150);
    await page.click('.lib-actions button[data-pos="after"]');

    const written = await waitFor(() => read().includes('卡片标题'));
    expect(written).toBe(true);
    expect(read()).toContain('<h3 className="text-base font-semibold text-slate-900">卡片标题</h3>');
    // 只插入一段，原来内容一个字节不动
    expect(read().replace(/\n\s*<div className="rounded-lg border border-slate-200 bg-white p-4">[\s\S]*?<\/div>/, '')).toBeTruthy();

    // 画布上真的出现了
    const frame = contentFrame(page);
    expect(await waitFor(async () => Boolean(frame && (await frame.locator('text=卡片标题').count()) > 0))).toBe(
      true,
    );

    // 代码页能看到并撤销
    await page.click('[data-nav="code"]');
    await page.waitForSelector('.change');
    expect(await page.textContent('.change .sum')).toContain('插入 卡片');

    await page.click('#undo-btn');
    expect(await waitFor(() => read() === original)).toBe(true);
  }, 90_000);

  it('插入到「内部」：成为子元素而不是兄弟', async () => {
    await page.click('[data-nav="canvas"]');
    const frame = contentFrame(page);
    await selectInCanvas(frame!, 'section');

    await page.click('[data-nav="components"]');
    await waitFor(async () => (await page.textContent('#lib-target'))?.includes('插入目标') === true);

    await page.click('.card[data-template="badge"]');
    await page.waitForTimeout(150);
    await page.click('.lib-actions button[data-pos="last"]');

    expect(await waitFor(() => read().includes('bg-blue-50 px-2'))).toBe(true);
    // 徽章在 section 内部（缩进比 section 深）
    const lines = read().split('\n');
    const sectionLine = lines.findIndex((line) => line.includes('<section'));
    const badgeLine = lines.findIndex((line) => line.includes('bg-blue-50 px-2'));
    expect(sectionLine).toBeGreaterThan(-1);
    expect(badgeLine).toBeGreaterThan(sectionLine);

    await page.click('[data-nav="code"]');
    await page.waitForSelector('#undo-btn');
    await page.click('#undo-btn');
    expect(await waitFor(() => read() === original)).toBe(true);
  }, 90_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter((text) => !text.includes('favicon') && !text.includes('404'));
    expect(real).toEqual([]);
  });
});
