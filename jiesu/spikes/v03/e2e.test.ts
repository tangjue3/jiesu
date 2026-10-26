/**
 * 端到端验证 V0.3 图层面板：真实 Chrome 里点树节点能选中页面元素，
 * 点页面元素树里也会高亮——两个入口必须表现一致。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../src/server/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PATH = join(DEMO, 'src', 'App.tsx');

const original = readFileSync(APP_PATH, 'utf8');
const restore = (): void => writeFileSync(APP_PATH, original, 'utf8');

interface Row {
  key: string;
  tag: string;
  cls: string;
  text: string;
  selected: boolean;
  hasCaret: boolean;
}

const readRows = (page: Page): Promise<Row[]> =>
  page.evaluate(() => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    return Array.from(shadow?.querySelectorAll<HTMLElement>('.jd-lrow') ?? []).map((row) => ({
      key: row.dataset.jdKey ?? '',
      tag: row.querySelector('.jd-ltag')?.textContent ?? '',
      cls: row.querySelector('.jd-lcls')?.textContent ?? '',
      text: row.querySelector('.jd-ltxt')?.textContent ?? '',
      selected: row.classList.contains('sel'),
      hasCaret: (row.querySelector('.jd-care')?.textContent ?? '').length > 0,
    }));
  });

const readPanel = (page: Page) =>
  page.evaluate(() => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    return {
      open: Boolean(shadow?.querySelector('.jd-panel')?.classList.contains('on')),
      src: shadow?.querySelector('.jd-src')?.textContent ?? '',
      count: shadow?.querySelector('.jd-lcount')?.textContent ?? '',
      layersVisible: !shadow?.querySelector('.jd-layers')?.classList.contains('off'),
      highlight: (shadow?.querySelector('.jd-hl') as HTMLElement | null)?.style.display ?? 'none',
    };
  });

/** 在页面里点某个元素（直接派发，避免命中内部子元素）。 */
async function clickPage(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel: string) => {
    document
      .querySelector(sel)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }, selector);
  await page.waitForTimeout(200);
}

/** 点图层树里某一行的标签文字匹配到的行。 */
async function clickRow(page: Page, match: { tag: string; text?: string }): Promise<void> {
  await page.evaluate((want: { tag: string; text?: string }) => {
    const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
    const rows = Array.from(shadow?.querySelectorAll<HTMLElement>('.jd-lrow') ?? []);
    const row = rows.find((item) => {
      const tag = item.querySelector('.jd-ltag')?.textContent ?? '';
      if (tag !== want.tag) return false;
      if (!want.text) return true;
      return (item.querySelector('.jd-ltxt')?.textContent ?? '').includes(want.text);
    });
    if (!row) throw new Error(`图层里找不到 ${want.tag} ${want.text ?? ''}`);
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }, match);
  await page.waitForTimeout(250);
}

/** 反复展开所有折叠节点，直到整棵树都摊开（模拟用户逐层点开）。 */
async function expandAll(page: Page): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const opened = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const carets = Array.from(shadow?.querySelectorAll<HTMLElement>('.jd-lrow') ?? [])
        .map((row) => row.querySelector('.jd-care') as HTMLElement | null)
        .filter((caret): caret is HTMLElement => Boolean(caret) && caret!.textContent === '▸');
      for (const caret of carets) {
        caret.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      }
      return carets.length;
    });
    if (opened === 0) return;
    await page.waitForTimeout(80);
  }
}

describe('V0.3 · 图层面板（真实 Chrome）', () => {
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
      server: { host: '127.0.0.1', port: 5204, strictPort: true },
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

    await page.goto('http://127.0.0.1:5204/', { waitUntil: 'networkidle' });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await server?.close();
    rmSync(join(DEMO, '.jiesu'), { recursive: true, force: true });
    restore();
  });

  it('默认收起，左侧保留一个常驻标签（不遮挡画布）', async () => {
    const state = await readPanel(page);
    expect(state.layersVisible).toBe(false);
    const tab = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      return Boolean(shadow?.querySelector('.jd-tab-l.on'));
    });
    expect(tab).toBe(true);
  });

  it('点标签展开后列出页面结构', async () => {
    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      (shadow?.querySelector('.jd-tab-l') as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(250);

    const rows = await readRows(page);
    const state = await readPanel(page);
    expect(state.layersVisible).toBe(true);
    expect(rows.length).toBeGreaterThan(3);
    // 顶层是 body 之下：div / header / section …
    expect(rows.map((r) => r.tag)).toContain('header');
    expect(rows.map((r) => r.tag)).toContain('section');
    expect(state.count).toMatch(/\d+ 可编辑/);
  });

  it('行上带类名摘要与文本，长树里能认出是哪个节点', async () => {
    await expandAll(page);
    const rows = await readRows(page);
    const header = rows.find((row) => row.tag === 'header');
    expect(header?.cls).toContain('flex');
    const h1 = rows.find((row) => row.tag === 'h1');
    expect(h1?.text).toBe('图层');
  });

  it('点图层节点 → 选中页面元素并打开属性面板', async () => {
    await expandAll(page);
    await clickRow(page, { tag: 'h2', text: '卡片一' });
    const state = await readPanel(page);
    expect(state.open).toBe(true);
    expect(state.src).toContain('App.tsx');

    // 页面上的选中框应当落在第一张卡片的 h2 上
    const matched = await page.evaluate(() => {
      const h2 = document.querySelector('article h2') as HTMLElement | null;
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const box = shadow?.querySelector('.jd-hl') as HTMLElement | null;
      if (!h2 || !box) return null;
      const rect = h2.getBoundingClientRect();
      return {
        left: Math.round(Number.parseFloat(box.style.left)),
        top: Math.round(Number.parseFloat(box.style.top)),
        expectedLeft: Math.round(rect.left),
        expectedTop: Math.round(rect.top),
      };
    });
    expect(matched).not.toBeNull();
    expect(matched!.left).toBe(matched!.expectedLeft);
    expect(matched!.top).toBe(matched!.expectedTop);
  });

  it('点页面元素 → 图层树里对应行高亮', async () => {
    await page.keyboard.press('Alt+Shift+J'); // 进入选择模式
    await page.waitForTimeout(150);
    await clickPage(page, 'article h2');

    const rows = await readRows(page);
    const selected = rows.filter((row) => row.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0].tag).toBe('h2');
    expect(selected[0].text).toBe('卡片一');
  });

  it('折叠节点后子节点从树里消失', async () => {
    const before = await readRows(page);
    const section = before.find((row) => row.tag === 'section');
    expect(section).toBeTruthy();

    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const rows = Array.from(shadow?.querySelectorAll<HTMLElement>('.jd-lrow') ?? []);
      const row = rows.find((item) => item.querySelector('.jd-ltag')?.textContent === 'section');
      (row?.querySelector('.jd-care') as HTMLElement | undefined)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true }),
      );
    });
    await page.waitForTimeout(200);

    const after = await readRows(page);
    expect(after.length).toBeLessThan(before.length);
    expect(after.map((row) => row.tag)).not.toContain('article');
  });

  it('悬停图层节点会在页面上画出高亮（不改变选中态）', async () => {
    const before = await readPanel(page);
    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const rows = Array.from(shadow?.querySelectorAll<HTMLElement>('.jd-lrow') ?? []);
      const row = rows.find((item) => item.querySelector('.jd-ltag')?.textContent === 'header');
      row?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    });
    const hovering = await readPanel(page);
    expect(hovering.highlight).toBe('block');
    // 选中态没被 hover 改掉：面板仍开着且仍指向 App.tsx
    expect(before.open).toBe(true);
    expect(hovering.open).toBe(true);
  });

  it('Alt+Shift+L 可以收起与展开图层面板', async () => {
    await page.keyboard.press('Alt+Shift+L');
    await page.waitForTimeout(150);
    expect((await readPanel(page)).layersVisible).toBe(false);

    const tabVisible = await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      return Boolean(shadow?.querySelector('.jd-tab-l.on'));
    });
    expect(tabVisible).toBe(true);

    await page.keyboard.press('Alt+Shift+L');
    await page.waitForTimeout(200);
    expect((await readPanel(page)).layersVisible).toBe(true);
    expect((await readRows(page)).length).toBeGreaterThan(0);
  });

  it('写回改动后图层标签跟着更新（class 摘要不过期）', async () => {
    // 选中 header 里的 h1，改字号
    await clickRow(page, { tag: 'h1', text: '图层' });
    await page.evaluate(() => {
      const shadow = document.querySelector('[data-jiesu-overlay]')?.shadowRoot;
      const rows = Array.from(shadow?.querySelectorAll<HTMLElement>('.jd-row') ?? []);
      const row = rows.find((item) => item.querySelector('label')?.textContent === '字号');
      const select = row?.querySelector('select') as HTMLSelectElement | undefined;
      if (!select) throw new Error('找不到字号选择器');
      select.value = 'text-2xl';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const changed = await (async () => {
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (readFileSync(APP_PATH, 'utf8').includes('text-2xl')) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    })();
    expect(changed).toBe(true);

    // 等 HMR + 图层脏标记重画
    await page.waitForTimeout(1200);
    const rows = await readRows(page);
    const h1 = rows.find((row) => row.tag === 'h1');
    expect(h1?.cls).toContain('text-2xl');
  }, 60_000);

  it('页面无 JS 运行时错误（忽略静态资源 404）', () => {
    const real = consoleErrors.filter(
      (e) => !e.includes('404') && !e.includes('favicon') && !e.includes('Failed to load resource'),
    );
    expect(real).toEqual([]);
  });
});
