/**
 * S3 · 端到端（真实 Chrome + 真实 HMR）
 *
 * 验证真实场景下的核心体验：
 *   选中一个元素 → 改一个数值 → 代码写回 → Vite HMR → React 重渲染
 *   → **选中态没有丢**，面板还在，值已刷新，可以继续改下一个属性
 *
 * 这是 S3 的最终判据：编辑循环是否连贯。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';

const HERE = dirname(fileURLToPath(import.meta.url));
// 独立的 demo 目录：不能与 v01 的 e2e 共用同一份 App.tsx，
// 否则两个测试会互相污染对方断言的文件内容（各自改写 gap 值）。
const DEMO = join(HERE, 'demo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PATH = join(DEMO, 'src', 'App.tsx');

const original = readFileSync(APP_PATH, 'utf8');
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');

async function waitFor(fn: () => boolean, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** 读覆盖层当前面板状态。 */
async function readPanel(page: Page): Promise<{
  open: boolean;
  src: string;
  labels: string[];
  values: string[];
}> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-jiesu-overlay]');
    const shadow = host?.shadowRoot;
    const rows = Array.from(shadow?.querySelectorAll('.jd-row') ?? []);
    return {
      open: Boolean(shadow?.querySelector('.jd-panel')?.classList.contains('on')),
      src: shadow?.querySelector('.jd-src')?.textContent ?? '',
      labels: rows.map((r) => r.querySelector('label')?.textContent ?? ''),
      values: rows.map((r) => r.querySelector('input')?.value ?? ''),
    };
  });
}

/** 选中 nav 里的内层 flex 容器（props 丰富）。 */
async function selectInnerContainer(page: Page): Promise<void> {
  // 先进入选择模式（V0.1 的交互：Alt+Shift+J）
  const inSelecting = await page.evaluate(() => {
    const host = document.querySelector('[data-jiesu-overlay]');
    return Boolean(host?.shadowRoot?.querySelector('.jd-hint.on'));
  });
  if (!inSelecting) {
    await page.keyboard.press('Alt+Shift+J');
    await page.waitForTimeout(200);
  }

  await page.evaluate(() => {
    const el = document.querySelector('nav > div');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(300);
}

/** 改面板上第 index 个数值输入框。 */
async function setNumeric(page: Page, index: number, value: string): Promise<void> {
  const handle = await page.evaluateHandle((i: number) => {
    const host = document.querySelector('[data-jiesu-overlay]');
    const inputs = Array.from(
      host?.shadowRoot?.querySelectorAll('.jd-row input[type=number]') ?? [],
    );
    return inputs[i] ?? null;
  }, index);
  await page.evaluate(
    (payload: { el: any; value: string }) => {
      payload.el.value = payload.value;
      payload.el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { el: handle, value },
  );
}

describe('S3 · 端到端：HMR 后不丢选中', () => {
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
      server: { host: '127.0.0.1', port: 5201, strictPort: true },
    });
    await vite.listen();

    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--no-proxy-server'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto('http://127.0.0.1:5201/', { waitUntil: 'networkidle' });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    rmSync(join(DEMO, '.jiesu'), { recursive: true, force: true });
    restore();
  });

  it('元素带上了稳定 id（跨 HMR 不变）', async () => {
    const id = await page.getAttribute('nav > div', 'data-jiesu-id');
    expect(id).toBeTruthy();
    expect(id).toContain('App.tsx#');
  });

  it('选中元素 → 改数值 → HMR 后选中态仍在', async () => {
    await selectInnerContainer(page);
    const before = await readPanel(page);
    expect(before.open).toBe(true);
    expect(before.src).toContain('App.tsx');

    // 记录选中元素的稳定 id
    const selectedId = await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      const shadow = host?.shadowRoot;
      void shadow;
      return document.querySelector('nav > div')?.getAttribute('data-jiesu-id');
    });
    expect(selectedId).toBeTruthy();

    // 改间距 → 触发写回 + HMR（48px = gap-12）
    await setNumeric(page, 0, '48');
    const written = await waitFor(() => readFileSync(APP_PATH, 'utf8').includes('gap-12'));
    expect(written).toBe(true);

    // 等 HMR 完成（React 重新渲染）
    await page.waitForTimeout(1500);

    // 关键断言：面板还开着，且仍指向同一个元素
    const after = await readPanel(page);
    expect(after.open).toBe(true);
    expect(after.src).toContain('App.tsx');
    expect(after.labels).toEqual(before.labels);
  }, 60_000);

  it('HMR 后属性面板的数值已刷新为新值', async () => {
    await page.waitForTimeout(500);
    const panel = await readPanel(page);
    // gap 从 12px(gap-3) 改到 48px(gap-12) → 面板应显示 48
    const gapIndex = panel.labels.indexOf('间距');
    expect(gapIndex).toBeGreaterThanOrEqual(0);
    expect(panel.values[gapIndex]).toBe('48');
  }, 60_000);

  it('可以连续修改：第二次改动仍然作用在同一元素上', async () => {
    // 改排列方向：flex → flex-col（这是 nav > div 上的枚举属性）
    const before = readFileSync(APP_PATH, 'utf8');
    const selectResult = await page.evaluate(() => {
      const host = document.querySelector('[data-jiesu-overlay]');
      const shadow = host?.shadowRoot;
      const rows = Array.from(shadow?.querySelectorAll('.jd-row') ?? []);
      const row = rows.find((r) => r.querySelector('label')?.textContent === '排列方向');
      const select = row?.querySelector('select') as HTMLSelectElement | undefined;
      if (!select) return null;
      select.value = 'flex-col';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    expect(selectResult).not.toBeNull();

    const changed = await waitFor(() => readFileSync(APP_PATH, 'utf8') !== before);
    expect(changed).toBe(true);
    const updated = readFileSync(APP_PATH, 'utf8');
    expect(updated).toContain('flex-col');
    // nav 自己的 flex 没被动（改的是内层容器）
    expect(updated).toContain('className="flex items-center justify-between gap-4 px-6 py-4"');
  }, 60_000);

  it('用户在编辑器里改文件导致行号漂移：选中态仍在，改动仍落对元素', async () => {
    // 直接在文件上方插入一行 → 行号漂移，但 JSX 结构没变
    const code = readFileSync(APP_PATH, 'utf8');
    writeFileSync(APP_PATH, `// 用户在编辑器里加了一行\n${code}`, 'utf8');
    await page.waitForTimeout(1500);

    // 选中态应该还在（结构锚点没变）
    const panel = await readPanel(page);
    expect(panel.open).toBe(true);

    // 再改一次 → 应当仍能正确写回 nav 里的元素，而不是别的元素
    const before = readFileSync(APP_PATH, 'utf8');
    await setNumeric(page, 0, '32');
    const changed = await waitFor(() => readFileSync(APP_PATH, 'utf8') !== before);
    expect(changed).toBe(true);

    const updated = readFileSync(APP_PATH, 'utf8');
    // 目标容器的 gap 变成 gap-8(32px)
    expect(updated).toContain('gap-8');
    // nav 自己的 gap-4 没被动 → 说明改的是内层容器，没打错元素
    expect(updated).toContain('className="flex items-center justify-between gap-4 px-6 py-4"');
  }, 60_000);

  it('页面无 JS 运行时错误', () => {
    const real = consoleErrors.filter(
      (e) => !e.includes('404') && !e.includes('favicon') && !e.includes('Failed to load resource'),
    );
    expect(real).toEqual([]);
  });
});
