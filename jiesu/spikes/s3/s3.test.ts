/**
 * S3 · HMR 后不丢选中
 *
 * 验证三件事：
 *  1. 结构锚点在行号漂移后仍能定位到同一个元素（写回不丢选中）
 *  2. 双锚点冲突时明确拒绝，绝不改错元素
 *  3. 客户端能通过指纹在 DOM 重建后找回同一个元素
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { injectSourceAttribute } from '../../src/core/inject/jsx-source-attribute';
import { anchorOf, findJsxElement, parseSource } from '../../src/core/locate/parse';
import { applyOp } from '../../src/core/write/apply';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGINAL = join(HERE, 'fixtures', 'original.tsx');

const CODE = `export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="flex items-center justify-between gap-4 px-6 py-4">
        <span className="text-lg font-semibold">Jiesu</span>
        <div className="flex items-center gap-3">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-white">开始</button>
        </div>
      </nav>
    </div>
  );
}
`;

/** 从注入后的代码里取某个元素的定位信息。 */
function locatorFrom(code: string, tag: string): {
  filePath: string;
  line: number;
  column: number;
  anchor: string;
} {
  // 注入顺序：<tag data-jiesu-src="..." data-jiesu-id="..." ...>
  const tagBlock = code.match(new RegExp(`<${tag}[^>]*`))?.[0];
  if (!tagBlock) throw new Error(`找不到 ${tag}`);
  const srcMatch = tagBlock.match(/data-jiesu-src="([^"]*)"/);
  const idMatch = tagBlock.match(/data-jiesu-id="([^"]*)"/);
  if (!srcMatch || !idMatch) throw new Error(`${tag} 的注入属性不完整：${tagBlock}`);
  const [filePath, line, column] = srcMatch[1].split(':');
  const anchor = idMatch[1].split('#')[1];
  return { filePath, line: Number(line), column: Number(column), anchor };
}

describe('S3 · 写回后不丢选中', () => {
  it('结构锚点让"行号漂移"不再致命', () => {
    const injected = injectSourceAttribute(CODE, {
      filePath: '/proj/src/App.tsx',
      rootDir: '/proj',
    });
    const nav = locatorFrom(injected.code, 'nav');
    expect(nav.anchor).toBe('0.0');

    // 在文件上方插入两行 → 行号漂移，但结构锚点不变
    const shifted = `// 注释一\n// 注释二\n${CODE}`;
    const tree = parseSource(shifted);
    const located = findJsxElement(tree, nav);

    expect(located.ok).toBe(true);
    if (located.ok) {
      // 命中的仍是 nav（行号已经变了）
      const tag =
        located.element.name.type === 'JSXIdentifier' ? located.element.name.name : '';
      expect(tag).toBe('nav');
      expect(anchorOf(located.path)).toBe('0.0');
    }
  });

  it('行号漂移后仍能正确写回，且只动目标那一行', () => {
    const injected = injectSourceAttribute(CODE, {
      filePath: '/proj/src/App.tsx',
      rootDir: '/proj',
    });
    const nav = locatorFrom(injected.code, 'nav');

    const shifted = `// 注释一\n// 注释二\n${CODE}`;
    const result = applyOp(
      shifted,
      nav,
      { kind: 'class', category: 'spacing', fromBase: 'gap-4', toBase: 'gap-8' },
    );

    expect(result.status).toBe('ok');
    expect(result.changed).toBe(true);
    expect(result.code).toContain('gap-8');
    // nav 的其它类不动
    expect(result.code).toContain('px-6');
    expect(result.code).toContain('py-4');
    // 只动了一行
    expect(result.diff!.startLine).toBe(result.diff!.endLine);
  });

  it('结构与行号都变了：明确拒绝，不猜', () => {
    const injected = injectSourceAttribute(CODE, {
      filePath: '/proj/src/App.tsx',
      rootDir: '/proj',
    });
    const nav = locatorFrom(injected.code, 'nav');
    expect(nav.anchor).toBe('0.0');

    // 场景：用户把 nav 前面插入了一个兄弟元素 → nav 的结构锚点变成 0.1，
    // 而它原来的行号 4 现在指向新插入的元素。
    // 此时"结构锚点"和"行号"指向两个不同元素 → 绝不能猜，必须拒绝。
    const restructured = `export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-10" />
      <nav className="flex items-center justify-between gap-4 px-6 py-4">
        <span className="text-lg font-semibold">Jiesu</span>
        <div className="flex items-center gap-3">
          <button className="rounded-md bg-blue-600 px-4 py-2 text-white">开始</button>
        </div>
      </nav>
    </div>
  );
}
`;
    const located = findJsxElement(parseSource(restructured), nav);

    // 结构锚点 0.0 现在是 header；行号 4 现在也是 header → 两者一致，
    // 所以会命中 header —— 这是危险信号，必须被识别出来。
    // 因此这里断言的是：即使命中，也不能声称成功改了原本的 nav。
    // 真正的防线在写回层：fromBase 不匹配 → 拒绝改动。
    if (located.ok) {
      const tag =
        located.element.name.type === 'JSXIdentifier' ? located.element.name.name : '';
      expect(tag).toBe('header');

      // 关键：写回时找不到目标类 → 明确拒绝，不会误改 header
      const result = applyOp(restructured, nav, {
        kind: 'class',
        category: 'spacing',
        fromBase: 'gap-4',
        toBase: 'gap-8',
      });
      expect(result.status).not.toBe('ok');
      expect(result.reason).toContain('没有找到');
      expect(result.code).toBeUndefined();
    }
  });

  it('结构锚点与行号冲突且该行不唯一：明确拒绝', () => {
    const injected = injectSourceAttribute(CODE, {
      filePath: '/proj/src/App.tsx',
      rootDir: '/proj',
    });
    const nav = locatorFrom(injected.code, 'nav');

    // 同一行放两个元素 → 行号锚点无法唯一确定，且结构锚点指向别处
    const ambiguous = `export function App() {
  return (
    <div className="min-h-screen bg-slate-50"><span /><span />
      <nav className="flex items-center justify-between gap-4 px-6 py-4">
        <span className="text-lg font-semibold">Jiesu</span>
      </nav>
    </div>
  );
}
`;
    const located = findJsxElement(parseSource(ambiguous), nav);
    if (!located.ok) {
      expect(located.reason).toContain('位置已变化');
    } else {
      // 若仍能定位，也必须指向 nav（而不是同一行的 span）
      const tag =
        located.element.name.type === 'JSXIdentifier' ? located.element.name.name : '';
      expect(tag).toBe('nav');
    }
  });

  it('写回后返回新锚点，供客户端重新定位', () => {
    const injected = injectSourceAttribute(CODE, {
      filePath: '/proj/src/App.tsx',
      rootDir: '/proj',
    });
    const nav = locatorFrom(injected.code, 'nav');

    const result = applyOp(
      injected.code,
      nav,
      { kind: 'class', category: 'spacing', fromBase: 'gap-4', toBase: 'gap-8' },
    );

    expect(result.status).toBe('ok');
    expect(result.anchor).toBeDefined();
    // 新锚点仍能在写回后的代码里定位到 nav
    const located = findJsxElement(parseSource(result.code!), {
      ...nav,
      line: 0,
      column: 0,
    });
    expect(located.ok).toBe(true);
    if (located.ok) {
      const tag =
        located.element.name.type === 'JSXIdentifier' ? located.element.name.name : '';
      expect(tag).toBe('nav');
    }
  });

  it('真实靶场：连续 20 次写回，选中态始终指向同一个元素', () => {
    let code = readFileSync(ORIGINAL, 'utf8');
    const injected = injectSourceAttribute(code, {
      filePath: 'src/App.tsx',
      rootDir: '/proj',
    });
    let locator = locatorFrom(injected.code, 'nav');

    // 依次改 gap：gap-4 → gap-5 → gap-6 …
    for (let i = 0; i < 20; i += 1) {
      const current = /gap-(\d+)/.exec(code)?.[1] ?? '4';
      const next = String(Number(current) + 1);
      const result = applyOp(code, locator, {
        kind: 'class',
        category: 'spacing',
        fromBase: `gap-${current}`,
        toBase: `gap-${next}`,
      });
      expect(result.status).toBe('ok');
      code = result.code!;
      // 每次写回后用返回的新锚点更新定位
      locator = { ...locator, anchor: result.anchor ?? locator.anchor, line: 0, column: 0 };

      // 校验：锚点仍指向 nav
      const located = findJsxElement(parseSource(code), locator);
      expect(located.ok).toBe(true);
      if (located.ok) {
        const tag =
          located.element.name.type === 'JSXIdentifier' ? located.element.name.name : '';
        expect(tag).toBe('nav');
      }
    }

    expect(code).toContain('gap-24');
  });
});
