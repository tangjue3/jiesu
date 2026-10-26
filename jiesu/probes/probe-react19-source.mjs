/**
 * 探针：React 19 下，从 DOM 节点能否反查到源码位置？
 *
 * 验证三件事：
 *  1. React 19 的 jsxDEV 是否仍把 source 放进 props.__source
 *  2. host fiber 的 memoizedProps 里是否还带着 __source（元素级定位）
 *  3. fiber 上的 _debugSource / _debugStack 现状
 *
 * 结论直接决定 L0 方案是否可用。
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { jsxDEV } = await import('react/jsx-dev-runtime');

console.log('React 版本:', React.version);

const SOURCE = { fileName: '/src/components/Card.tsx', lineNumber: 42, columnNumber: 8 };

function Card() {
  return jsxDEV(
    'div',
    { className: 'p-4 text-white', __source: SOURCE },
    undefined,
    false,
    SOURCE,
    undefined,
  );
}

const root = createRoot(document.getElementById('root'));
await React.act(async () => {
  root.render(React.createElement(Card));
});

await new Promise((r) => setTimeout(r, 100));

const node = document.querySelector('#root > div');
console.log('body.innerHTML:', document.body.innerHTML);
console.log('DOM 节点 class:', node?.className);

const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
console.log('fiber 属性 key:', fiberKey ? '找到' : '未找到');

if (fiberKey) {
  const fiber = node[fiberKey];
  console.log('--- host fiber ---');
  console.log('  memoizedProps.__source:', JSON.stringify(fiber.memoizedProps?.__source));
  console.log('  pendingProps.__source  :', JSON.stringify(fiber.pendingProps?.__source));
  console.log('  _debugSource           :', JSON.stringify(fiber._debugSource ?? null));
  console.log('  _debugStack            :', fiber._debugStack ? String(fiber._debugStack).split('\n')[0] : null);

  // 向上找 composite fiber
  let p = fiber.return;
  let composite = null;
  while (p) {
    if (typeof p.type === 'function') {
      composite = p;
      break;
    }
    p = p.return;
  }
  console.log('--- composite fiber (Card) ---');
  console.log('  type.name        :', composite?.type?.name);
  console.log('  _debugSource     :', JSON.stringify(composite?._debugSource ?? null));
  console.log('  _debugStack 首行 :', composite?._debugStack ? String(composite._debugStack).split('\n')[0] : null);
  console.log('  memoizedProps.__source:', JSON.stringify(composite?.memoizedProps?.__source ?? null));
}
