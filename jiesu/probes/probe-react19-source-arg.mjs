/**
 * 探针：React 19 的 jsxDEV 收到 source 参数后，存到哪里？
 * 只传 source 参数（不手动塞 __source prop），与真实编译产物一致。
 */
import { JSDOM } from 'jsdom';

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
const { jsxDEV } = await import('react/jsx-dev-runtime');

const SOURCE = { fileName: '/src/components/Card.tsx', lineNumber: 42, columnNumber: 8 };

function Card() {
  // 与 @vitejs/plugin-react 的真实产物结构一致：source 作为第 5 个参数
  return jsxDEV('div', { className: 'p-4 text-white' }, undefined, false, SOURCE, undefined);
}

const root = createRoot(document.getElementById('root'));
await React.act(async () => {
  root.render(React.createElement(Card));
});

const node = document.querySelector('#root > div');
console.log('DOM:', node?.outerHTML);

const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
const fiber = node[fiberKey];

console.log('--- host fiber ---');
console.log('  memoizedProps          :', JSON.stringify(fiber.memoizedProps));
console.log('  memoizedProps.__source :', JSON.stringify(fiber.memoizedProps?.__source ?? null));
console.log('  _debugSource           :', JSON.stringify(fiber._debugSource ?? null));
console.log('  _debugStack 首行       :', fiber._debugStack ? String(fiber._debugStack).split('\n')[0] : null);
console.log('  alternate              :', fiber.alternate ? '有' : '无');
console.log('  alternate.memoizedProps.__source:', JSON.stringify(fiber.alternate?.memoizedProps?.__source ?? null));

// React 是否把 source 挂在 element 上？通过 fiber.stateNode / element 反查
let p = fiber;
console.log('--- 沿 fiber 树找 element 上的 source ---');
const keys = new Set();
let cur = fiber;
while (cur) {
  Object.keys(cur).forEach((k) => keys.add(k));
  cur = cur.return;
}
console.log('  fiber 上出现过的 key（部分）:', [...keys].filter((k) => k.startsWith('_debug') || k.includes('source') || k.includes('Source')).join(', '));

console.log('--- _debugInfo 内容 ---');
console.log('  host fiber._debugInfo:', JSON.stringify(fiber._debugInfo ?? null)?.slice(0, 400));
let comp = fiber.return;
while (comp && typeof comp.type !== 'function') comp = comp.return;
console.log('  composite._debugInfo:', JSON.stringify(comp?._debugInfo ?? null)?.slice(0, 400));
console.log('  composite._debugStack 全文:\n', comp?._debugStack ? String(comp._debugStack).split('\n').slice(0, 6).join('\n') : null);
