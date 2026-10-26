import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findJsxElement, parseSource } from '../../src/core/locate/parse';
import { applyStructure } from '../../src/core/write/structure';
import { locateByClassToken, locateByText } from '../_shared/jsx-fixture';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** 插入一个按钮的片段（多行也要能正确缩进）。 */
const BUTTON = `<button className="rounded-md bg-blue-600 px-4 py-2 text-white">新按钮</button>`;

describe('S5 · 结构化编辑：插入 / 删除 / 复制', () => {
  it('插到同级后面：只多一行，缩进跟邻居一致', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'text-lg'), {
      kind: 'insert',
      position: 'after',
      snippet: BUTTON,
    });

    expect(result.status).toBe('ok');
    expect(result.changed).toBe(true);
    // 缩进照抄目标元素（6 空格），不是硬编码 2 空格
    expect(result.code).toContain('\n      <button className="rounded-md bg-blue-600 px-4 py-2 text-white">新按钮</button>\n');
    // 除了新增这一行，原文逐字节不变
    expect(result.code!.replace(`\n      ${BUTTON}`, '')).toBe(code);
    // 新元素的锚点必须回传（客户端靠它选中新节点）
    expect(result.newAnchor).toBeTruthy();
    expect(result.newLine).toBe(5);
  });

  it('插到同级前面：插在目标行之上', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'empty-slot'), {
      kind: 'insert',
      position: 'before',
      snippet: BUTTON,
    });

    expect(result.status).toBe('ok');
    expect(result.code).toContain(`\n      ${BUTTON}\n      <div className="empty-slot">`);
    expect(result.code!.replace(`      ${BUTTON}\n`, '')).toBe(code);
  });

  it('插到容器末尾：在最后一个子元素之后', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'grid'), {
      kind: 'insertChild',
      position: 'last',
      snippet: `<div className="rounded-lg border p-4">卡片三</div>`,
    });

    expect(result.status).toBe('ok');
    const updated = result.code!;
    // 顺序：卡片一 → 卡片二 → 卡片三（在 </section> 之前）
    expect(updated.indexOf('卡片一')).toBeLessThan(updated.indexOf('卡片二'));
    expect(updated.indexOf('卡片二')).toBeLessThan(updated.indexOf('卡片三'));
    expect(updated.indexOf('卡片三')).toBeLessThan(updated.indexOf('</section>'));
    // 缩进与兄弟一致
    expect(updated).toContain('\n        <div className="rounded-lg border p-4">卡片三</div>\n');
  });

  it('插到容器开头：在第一个子元素之前', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'grid'), {
      kind: 'insertChild',
      position: 'first',
      snippet: `<div className="rounded-lg border p-4">卡片零</div>`,
    });

    expect(result.status).toBe('ok');
    const updated = result.code!;
    expect(updated.indexOf('卡片零')).toBeLessThan(updated.indexOf('卡片一'));
  });

  it('空容器：撑成多行，缩进按容器推一层', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'empty-slot'), {
      kind: 'insertChild',
      position: 'last',
      snippet: BUTTON,
    });

    expect(result.status).toBe('ok');
    expect(result.code).toContain(
      '<div className="empty-slot">\n        <button className="rounded-md bg-blue-600 px-4 py-2 text-white">新按钮</button>\n      </div>',
    );
  });

  it('自闭合组件：展开成有子元素的形式，不留 `<Card >`', () => {
    const code = `export function A() {
  return (
    <div className="wrap">
      <Card className="x" />
    </div>
  );
}
`;
    const result = applyStructure(code, locateByClassToken(code, 'x'), {
      kind: 'insertChild',
      position: 'last',
      snippet: BUTTON,
    });

    expect(result.status).toBe('ok');
    expect(result.code).toContain('<Card className="x">');
    expect(result.code).toContain('</Card>');
    expect(result.code).not.toContain(' />');
    expect(result.code).toContain('新按钮');
  });

  it('多行片段：内部缩进整体跟随目标层级', () => {
    const code = read('page.tsx');
    const multi = `<div className="rounded-lg border p-4">
  <span className="text-sm">说明</span>
</div>`;
    const result = applyStructure(code, locateByClassToken(code, 'empty-slot'), {
      kind: 'insert',
      position: 'after',
      snippet: multi,
    });

    expect(result.status).toBe('ok');
    // 首行 6 空格，内层 8 空格（6 + 片段自身相对缩进 2）
    expect(result.code).toContain('\n      <div className="rounded-lg border p-4">\n        <span className="text-sm">说明</span>\n      </div>\n');
  });

  it('删除独占一行的元素：连换行一起删掉，不留空行', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByText(code, '卡片一'), { kind: 'delete' });

    expect(result.status).toBe('ok');
    expect(result.code).not.toContain('卡片一');
    expect(result.code).not.toMatch(/\n\s*\n/);
    // 其它两处原样
    expect(result.code).toContain('卡片二');
    expect(result.code).toContain('empty-slot');
  });

  it('删除后建议选中父元素（而不是留一个死锚点）', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByText(code, '卡片一'), { kind: 'delete' });
    expect(result.nextAnchor).toBeTruthy();
    // 该锚点在删除后的源码里依然能定位到元素
    const tree = parseSource(result.code!);
    const target = tree.find((entry) => entry.path.join('.') === result.nextAnchor);
    expect(target).toBeDefined();
  });

  it('复制元素：插到它后面，内容一致', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByText(code, '卡片一'), { kind: 'duplicate' });

    expect(result.status).toBe('ok');
    const hits = result.code!.match(/卡片一/g) ?? [];
    expect(hits).toHaveLength(2);
    // 两份卡片二之前的顺序：卡片一 → 卡片一(副本) → 卡片二
    expect(result.code!.indexOf('卡片一')).toBeLessThan(result.code!.lastIndexOf('卡片一'));
  });

  it('新锚点能定位到刚插入的元素（端到端自洽）', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'text-lg'), {
      kind: 'insert',
      position: 'after',
      snippet: BUTTON,
    });
    expect(result.status).toBe('ok');

    const tree = parseSource(result.code!);
    const located = findJsxElement(tree, {
      filePath: 'page.tsx',
      line: result.newLine!,
      column: result.newColumn!,
      anchor: result.newAnchor!,
    });

    expect(located.ok).toBe(true);
    if (located.ok) {
      // 命中的确实是新插入的按钮
      const text = result.code!.slice(located.jsx.start!, located.jsx.end!);
      expect(text).toContain('新按钮');
    }
  });

  it('⚠️ 插入同级后，后面兄弟的结构锚点会顺移（不是"锚点永不漂移"）', () => {
    const code = read('page.tsx');
    const before = parseSource(code).map((entry) => ({
      path: entry.path.join('.'),
      line: entry.line,
    }));
    // 插入前：section 是 main 的第 2 个子元素 → 锚点 0.1，位于第 5 行
    expect(before.find((entry) => entry.path === '0.1')!.line).toBe(5);

    const result = applyStructure(code, locateByClassToken(code, 'text-lg'), {
      kind: 'insert',
      position: 'after',
      snippet: BUTTON,
    });
    const after = parseSource(result.code!).map((entry) => ({
      path: entry.path.join('.'),
      line: entry.line,
    }));

    // 插入后：新按钮占走了 0.1（第 5 行），section 被挤到 0.2（第 6 行）
    expect(after.find((entry) => entry.path === '0.1')!.line).toBe(5);
    expect(after.find((entry) => entry.path === '0.2')!.line).toBe(6);

    // 结论：结构锚点对"改属性/上方加行"是稳定的，但**结构编辑会重排同级索引**。
    // 所以插入/删除之后必须：
    //   1) 服务端回传新节点的锚点（newAnchor）；
    //   2) 客户端等 HMR 落地后从 DOM 重读锚点，再允许下一次编辑 —— 否则旧锚点会命中新元素。
  });

  it('结构编辑后若用旧锚点继续改，命中的会是新元素——所以必须串行化', () => {
    const code = read('page.tsx');
    const stale = locateByClassToken(code, 'grid'); // section：旧锚点 0.1、旧行号 5
    const result = applyStructure(code, locateByClassToken(code, 'text-lg'), {
      kind: 'insert',
      position: 'after',
      snippet: BUTTON,
    });

    // 用旧定位（0.1 + 第 5 行）在新文件里解析——两个锚点会"一致地"指向新按钮
    const located = findJsxElement(parseSource(result.code!), stale);
    expect(located.ok).toBe(true);
    if (located.ok) {
      const text = result.code!.slice(located.jsx.start!, located.jsx.end!);
      expect(text).not.toContain('grid'); // 不是 section 了
      expect(text).toContain('新按钮'); // 而是刚插入的按钮
    }
    // 这正是"插完必须刷新锚点、且下一次编辑要等 HMR 完成"的原因：
    // 双锚点在"整体顺移"时会同时命中同一个错误元素，交叉校验拦不住。
  });

  it('片段不是单根元素：明确拒绝', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'empty-slot'), {
      kind: 'insert',
      position: 'after',
      snippet: '<div>a</div><div>b</div>',
    });
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('单个元素');
    expect(result.code).toBeUndefined();
  });

  it('片段不是 JSX：明确拒绝', () => {
    const code = read('page.tsx');
    const result = applyStructure(code, locateByClassToken(code, 'empty-slot'), {
      kind: 'insert',
      position: 'after',
      snippet: 'const x = 1',
    });
    expect(result.status).toBe('unresolved');
    expect(result.code).toBeUndefined();
  });

  it('目标元素与同级挤在同一行：拒绝而不是插乱格式', () => {
    const code = `export function A() {
  return <div><span className="a">a</span><span className="b">b</span></div>;
}
`;
    const result = applyStructure(code, locateByClassToken(code, 'a'), {
      kind: 'insert',
      position: 'after',
      snippet: '<i>x</i>',
    });
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('同一行');
  });
});
