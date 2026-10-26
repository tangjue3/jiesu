/**
 * V0.5 端到端：结构编辑的交互与串行化。
 *
 * 前面 S5 已经从内核与协议层证明"插入节点成立"。这里验证的是**用户手上**那一半：
 *  1. 属性面板真的提供了复制 / 删除 / 插入组件的入口
 *  2. 插入期间整个结构区被锁住——因为插入会重排同级锚点，
 *     此时再发一次编辑会打错元素（S5 实测：旧锚点 + 旧行号会一致地指向新元素）
 *  3. 落地之后选中态自动变成新节点，接着改属性改的也是它
 *  4. 删除之后选中态退回父元素
 *
 * 全程真实 Chrome + 真实文件 + 真实 HMR，且用**面板按钮**驱动（不是 WebSocket 直连），
 * 因为要验证的正是 UI 这一层。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';
import { resetFromHead } from '../_shared/baseline';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PATH = join(DEMO, 'src', 'App.tsx');
const PORT = 5209;

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
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return false;
}

/** 选中页面上的一个元素（点哪选哪，用 dispatchEvent 避免命中内部子元素）。 */
async function select(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`找不到 ${sel}`);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }, selector);
  await page.waitForTimeout(250);
}

/** 点面板上的结构按钮（复制 / 删除 / 上方 / 下方 / 内部）。 */
async function clickStructButton(page: Page, text: string): Promise<void> {
  await page.evaluate((label: string) => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    const button = Array.from(shadow?.querySelectorAll<HTMLButtonElement>('[data-jd-struct]') ?? [])
      .find((item) => item.textContent === label);
    if (!button) throw new Error(`面板上没有「${label}」按钮`);
    button.click();
  }, text);
}

interface PanelState {
  open: boolean;
  src: string;
  toast: string;
  structLabels: string[];
  structDisabled: boolean[];
}

async function panelState(page: Page): Promise<PanelState> {
  return page.evaluate(() => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    const buttons = Array.from(shadow?.querySelectorAll<HTMLButtonElement>('[data-jd-struct]') ?? []);
    return {
      open: Boolean(shadow?.querySelector('.jd-panel')?.classList.contains('on')),
      src: shadow?.querySelector('.jd-src')?.textContent ?? '',
      toast: shadow?.querySelector('.jd-toast')?.textContent ?? '',
      structLabels: buttons.map((b) => b.textContent ?? ''),
      structDisabled: buttons.map((b) => b.disabled),
    };
  });
}

describe('V0.5 · 结构编辑的交互与串行化', () => {
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
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    restore();
  });

  it('属性面板提供复制 / 删除 / 插入组件的入口', async () => {
    await select(page, 'main > div > div:nth-of-type(1)');
    const state = await panelState(page);
    expect(state.open).toBe(true);
    expect(state.structLabels).toEqual(expect.arrayContaining(['复制', '删除', '上方', '下方', '内部']));
    // 空闲状态下按钮必须可用
    expect(state.structDisabled.every((disabled) => disabled === false)).toBe(true);
  }, 60_000);

  it('插入期间锁住结构区：不能连点，也不能同时改属性', async () => {
    // 选"按钮"模板（默认第一项是标题，这里显式切到按钮，让新节点文本可断言）
    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const select = shadow?.querySelector<HTMLSelectElement>('select[data-jd-template]');
      if (!select) throw new Error('面板上没有模板选择器');
      select.value = 'button';
    });

    await clickStructButton(page, '下方');

    // 按钮立刻应被禁用（插入会重排锚点，此时再点会打错元素）
    const locked = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const buttons = Array.from(
        shadow?.querySelectorAll<HTMLButtonElement>('[data-jd-struct]') ?? [],
      );
      return buttons.every((button) => button.disabled);
    });
    expect(locked).toBe(true);

    // 此时手动改一个数值 → 必须被拒绝，并说明原因
    const refused = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const input = shadow?.querySelector<HTMLInputElement>('.jd-row input[type=number]');
      if (!input) return { clicked: false, toast: '' };
      input.value = '99';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { clicked: true, toast: shadow?.querySelector('.jd-toast')?.textContent ?? '' };
    });
    expect(refused.clicked).toBe(true);
    expect(refused.toast).toContain('还在落地');
  }, 60_000);

  it('落地之后选中态变成新节点，接着改属性改的也是它', async () => {
    const written = await waitFor(() => read().includes('按钮'));
    expect(written).toBe(true);
    expect(read()).toContain('rounded-md bg-blue-600');

    // 等 HMR + 客户端接管新节点
    const adopted = await waitFor(async () => {
      const state = await panelState(page);
      return state.open && state.structDisabled.every((disabled) => disabled === false);
    });
    expect(adopted).toBe(true);

    // 选中态必须指向新插入的那个元素（面板源码位置与它自己的注入属性一致）
    const sameTarget = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const src = shadow?.querySelector('.jd-src')?.textContent ?? '';
      const btn = Array.from(document.querySelectorAll('button')).find((node) =>
        node.textContent?.includes('按钮'),
      );
      const own = btn?.getAttribute('data-jiesu-src') ?? '';
      return { src, own };
    });
    expect(sameTarget.own).toBeTruthy();
    // 面板上的源码位置应当就是这个新元素自己的位置（同一条 data-jiesu-src）
    expect(sameTarget.src).toBe(sameTarget.own);

    // 在这上面改内边距 → 必须改到新元素那一行，别的行不动
    const before = read();
    const changed = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const rows = Array.from(shadow?.querySelectorAll('.jd-row') ?? []);
      const row = rows.find((item) => item.querySelector('label')?.textContent === '左右内边距');
      const input = row?.querySelector<HTMLInputElement>('input[type=number]');
      if (!input) return false;
      input.value = '32';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    expect(changed).toBe(true);

    const patched = await waitFor(() => read() !== before);
    expect(patched).toBe(true);
    const updated = read();
    const buttonLine = updated.split('\n').find((line) => line.includes('bg-blue-600'));
    expect(buttonLine).toContain('px-8');
    // 别的行没被顺手改掉
    expect(updated).toContain('第一块');
    expect(updated).toContain('第二块');
  }, 90_000);

  it('删除之后选中态退回父元素，不留空行', async () => {
    const before = read();
    await clickStructButton(page, '删除');

    const removed = await waitFor(() => !read().includes('bg-blue-600'));
    expect(removed).toBe(true);
    const updated = read();
    expect(updated).not.toMatch(/\n\s*\n/);
    expect(updated.length).toBeLessThan(before.length);

    // 选中态应回到父容器（面板仍打开，且不再指向已删除的元素）
    const settled = await waitFor(async () => {
      const state = await panelState(page);
      return state.open && state.structDisabled.every((disabled) => disabled === false);
    });
    expect(settled).toBe(true);

    const parentSrc = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      return shadow?.querySelector('.jd-src')?.textContent ?? '';
    });
    expect(parentSrc).toContain('App.tsx');
  }, 90_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter((text) => !text.includes('favicon') && !text.includes('404'));
    expect(real).toEqual([]);
  });
});
