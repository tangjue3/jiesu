/**
 * S1 探针：验证"编译期发射 source → 运行时从 DOM 节点反查 file:line:col"整条链路。
 *
 * 覆盖三种编译管线：
 *  A. esbuild（jsxDev: true）—— vite 内部用于部分场景
 *  B. @vitejs/plugin-react（babel）
 *  C. @vitejs/plugin-react-swc
 */
import { readFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const SOURCE_FILE = `export function Card() {
  return (
    <div className="p-4 text-white">
      <h2 className="text-lg">标题</h2>
    </div>
  );
}
`;

const work = realpathSync(mkdtempSync(join(tmpdir(), 'jiesu-s1-')));
const srcPath = join(work, 'Card.tsx');
writeFileSync(srcPath, SOURCE_FILE);

/* ---------------- A. esbuild ---------------- */
const esbuildOut = await build({
  entryPoints: [srcPath],
  bundle: false,
  write: false,
  format: 'esm',
  jsx: 'automatic',
  jsxDev: true,
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.tsx': 'tsx' },
});
const esbuildCode = esbuildOut.outputFiles[0].text;
console.log('=== A. esbuild jsxDev ===');
console.log('产物含 __source :', esbuildCode.includes('__source'));
console.log('产物含 source   :', /source\s*[:=]/.test(esbuildCode));
console.log(
  '产物片段        :',
  esbuildCode.split('\n').find((l) => l.includes('source'))?.trim().slice(0, 120) ?? '(无)',
);

/* ---------------- B/C. Vite 真实管线 ---------------- */
const { createServer } = await import('vite');
const react = (await import('@vitejs/plugin-react')).default;

async function viteTransform(plugin, label) {
  const server = await createServer({
    configFile: false,
    root: work,
    logLevel: 'error',
    server: { middlewareMode: true },
    plugins: [plugin],
  });
  try {
    const result = await server.transformRequest(srcPath);
    const code = result?.code ?? '';
    console.log(`=== ${label} ===`);
    console.log('  产物含 __source :', code.includes('__source'));
    console.log('  产物含 jsxDEV   :', code.includes('jsxDEV'));
    const line = code.split('\n').find((l) => l.includes('__source') || l.includes('source:'));
    console.log('  片段            :', line?.trim().slice(0, 140) ?? '(无)');
    return code;
  } finally {
    await server.close();
  }
}

const babelCode = await viteTransform(react(), 'B. @vitejs/plugin-react (babel)');

/* ---------------- 运行时：从 DOM 节点反查 ---------------- */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');

// 用 esbuild 产物做运行时验证：把导出挂到全局，模拟模块副作用
const runtimePath = join(work, 'Card.runtime.mjs');
writeFileSync(runtimePath, esbuildCode);
const mod = await import(`file://${runtimePath}`);

const root = createRoot(document.getElementById('root'));
await React.act(async () => {
  root.render(React.createElement(mod.Card));
});

const node = document.querySelector('#root > div');
const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
const fiber = node[fiberKey];
const src = fiber.memoizedProps?.__source;

console.log('=== 运行时反查 ===');
console.log('DOM 元素      :', node.outerHTML.slice(0, 80));
console.log('fiber 命中    :', Boolean(fiberKey));
console.log('__source      :', JSON.stringify(src));
console.log('能否拿到行列  :', Boolean(src && src.fileName && src.lineNumber));
