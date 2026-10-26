import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

import { injectSourceAttribute } from '../../src/core/inject/jsx-source-attribute';

/**
 * 运行时验证：注入后的组件渲染到 DOM，用户选中元素时能否读回源码位置。
 * 这是"痛点① 找不到元素在哪"能否被解决的最终判据。
 */
export async function verifyRuntimeSourceLookup(): Promise<{
  html: string;
  divSource: string | null;
  h2Source: string | null;
}> {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'jiesu-runtime-')));
  const sourcePath = join(work, 'Card.tsx');
  const original = readFileSync(
    new URL('../s1/demo/src/Card.tsx', import.meta.url),
    'utf8',
  );
  writeFileSync(sourcePath, original);

  const injected = injectSourceAttribute(original, {
    filePath: sourcePath,
    rootDir: work,
  });

  const compiled = await build({
    stdin: {
      contents: injected.code,
      resolveDir: work,
      loader: 'tsx',
      sourcefile: 'Card.tsx',
    },
    bundle: false,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    jsxDev: true,
    define: { 'process.env.NODE_ENV': '"development"' },
  });

  // 产物必须放在包内，否则 node 解析不到 react/jsx-dev-runtime
  const outDir = fileURLToPath(new URL('../../node_modules/.jiesu-tmp/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const modulePath = join(outDir, 'Card.mjs');
  writeFileSync(modulePath, compiled.outputFiles[0].text);

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const mod = await import(`file://${modulePath}`);

  const root = createRoot(document.getElementById('root')!);
  await React.act(async () => {
    root.render(React.createElement(mod.Card));
  });

  const div = document.querySelector('#root > div');
  const h2 = document.querySelector('#root > div > h2');

  return {
    html: document.body.innerHTML,
    divSource: div?.getAttribute('data-jiesu-src') ?? null,
    h2Source: h2?.getAttribute('data-jiesu-src') ?? null,
  };
}
