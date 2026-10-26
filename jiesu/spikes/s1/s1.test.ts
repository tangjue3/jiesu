import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { build, createServer } from 'vite';
import { describe, expect, it } from 'vitest';

import { injectSourceAttribute } from '../../src/core/inject/jsx-source-attribute';
import { jiesu } from '../../src/vite-plugin';
import { verifyRuntimeSourceLookup } from './runtime';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');

describe('S1 · 编译期注入', () => {
  it('给每个 JSX 元素注入 data-jiesu-src 与 data-jiesu-id，且不破坏原格式', () => {
    const code = `export function Card() {
  return (
    <div className="p-4">
      <h2>标题</h2>
    </div>
  );
}
`;
    const result = injectSourceAttribute(code, {
      filePath: '/proj/src/Card.tsx',
      rootDir: '/proj',
    });

    expect(result.injected).toBe(2);
    expect(result.tooLate).toBe(false);
    expect(result.code).toContain(
      '<div data-jiesu-src="src/Card.tsx:3:4" data-jiesu-id="src/Card.tsx#0" className="p-4">',
    );
    expect(result.code).toContain(
      '<h2 data-jiesu-src="src/Card.tsx:4:6" data-jiesu-id="src/Card.tsx#0.0">标题</h2>',
    );
    // 原始代码除插入外不变
    expect(
      result.code
        .replace(/ data-jiesu-src="[^"]*"/g, '')
        .replace(/ data-jiesu-id="[^"]*"/g, ''),
    ).toBe(code);
  });

  it('组件标签、自闭合标签都能定位', () => {
    const code = `const a = <Foo.Bar prop={1} />;\nconst b = <br />;\n`;
    const result = injectSourceAttribute(code, { filePath: '/proj/src/a.tsx', rootDir: '/proj' });
    expect(result.injected).toBe(2);
    expect(result.code).toContain('<Foo.Bar data-jiesu-src="src/a.tsx:1:10"');
    expect(result.code).toContain('<br data-jiesu-src="src/a.tsx:2:10"');
  });

  it('结构锚点不随行号漂移：插入一行后 id 不变，行号变了', () => {
    const before = `export function Card() {
  return (
    <div className="p-4">
      <h2>标题</h2>
    </div>
  );
}
`;
    const after = `// 新增一行注释
export function Card() {
  return (
    <div className="p-4">
      <h2>标题</h2>
    </div>
  );
}
`;
    const a = injectSourceAttribute(before, { filePath: '/proj/src/Card.tsx', rootDir: '/proj' });
    const b = injectSourceAttribute(after, { filePath: '/proj/src/Card.tsx', rootDir: '/proj' });

    const idOf = (code: string, tag: string): string =>
      code.match(new RegExp(`<${tag}[^>]*`))?.[0].match(/data-jiesu-id="([^"]*)"/)?.[1] ?? '';
    const srcOf = (code: string, tag: string): string =>
      code.match(new RegExp(`<${tag}[^>]*`))?.[0].match(/data-jiesu-src="([^"]*)"/)?.[1] ?? '';

    // 结构锚点完全不变
    expect(idOf(b.code, 'h2')).toBe(idOf(a.code, 'h2'));
    expect(idOf(b.code, 'h2')).toBe('src/Card.tsx#0.0');
    // 行号漂移了 —— 这正是需要结构锚点的原因
    expect(srcOf(a.code, 'h2')).toBe('src/Card.tsx:4:6');
    expect(srcOf(b.code, 'h2')).toBe('src/Card.tsx:5:6');
  });

  it('JSX 已被编译时报告 tooLate（提示插件顺序）', () => {
    const compiled = `import { jsxDEV } from "react/jsx-dev-runtime";\nexport const A = () => jsxDEV("div", {}, void 0, false, { fileName: "a.tsx" }, this);\n`;
    const result = injectSourceAttribute(compiled, { filePath: '/proj/src/a.tsx' });
    expect(result.tooLate).toBe(true);
    expect(result.injected).toBe(0);
  });
});

describe('S1 · Vite 真实管线', () => {
  it(
    'dev 模式：transform 产物含 data-jiesu-src',
    async () => {
      const server = await createServer({
        root: DEMO,
        configFile: false,
        logLevel: 'error',
        server: { middlewareMode: true },
        optimizeDeps: { noDiscovery: true },
        plugins: [jiesu(), react()],
      });
      try {
        const result = await server.transformRequest('/src/Card.tsx');
      expect(result?.code).toBeDefined();
      expect(result!.code).toContain('"data-jiesu-src": "src/Card.tsx:3:4"');
      expect(result!.code).toContain('"data-jiesu-src": "src/Card.tsx:4:6"');
      expect(result!.code).toContain('"data-jiesu-id": "src/Card.tsx#0"');
      // React 插件照常工作（JSX 已被编译）
      expect(result!.code).toContain('jsxDEV');
      } finally {
        await server.close();
      }
    },
    120_000,
  );

  it(
    '生产构建：产物中不含任何注入属性',
    async () => {
      const result = await build({
        root: DEMO,
        configFile: false,
        logLevel: 'error',
        plugins: [jiesu(), react()],
        build: { write: false, minify: false },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const bundled = outputs
        .flatMap((o) => (o as any).output ?? [])
        .map((chunk: any) => chunk.code ?? '')
        .join('\n');
      expect(bundled.length).toBeGreaterThan(0);
      expect(bundled).not.toContain('data-jiesu-src');
      expect(bundled).not.toContain('data-jiesu-id');
    },
    120_000,
  );

  it(
    '运行时：DOM 元素上能直接读回源码位置（痛点① 的最终判据）',
    async () => {
      const { html, divSource, h2Source } = await verifyRuntimeSourceLookup();

      expect(html).toContain('data-jiesu-src');
      expect(divSource).toMatch(/Card\.tsx:3:4$/);
      expect(h2Source).toMatch(/Card\.tsx:4:6$/);
    },
    120_000,
  );
});
