/**
 * 拖拽重排的内核级验证：不经过浏览器，直接看写回结果。
 *
 * 核心命题：重排只移动节点文本，**空白、缩进、其它属性逐字节不变**。
 */
import { describe, expect, it } from 'vitest';

import { applyLayoutOp } from '../../src/core/layout/apply-layout';
import { auditLayoutSafety } from '../../src/core/layout/guard';
import { collectJsxTree, pathToAnchor } from '../../src/core/locate/jsx-tree';
import type { ElementLocator } from '../../src/core/locate/parse';

/** 按 class token 定位（不依赖 fixture 文件）。 */
function locatorByToken(code: string, token: string): ElementLocator {
  const entry = collectJsxTree(code).find((item) => {
    const attr = item.opening.attributes.find(
      (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'className',
    );
    if (!attr || attr.type !== 'JSXAttribute') return false;
    const value = attr.value;
    return value?.type === 'StringLiteral' && value.value.split(/\s+/).includes(token);
  });
  if (!entry) throw new Error(`找不到含 ${token} 的元素`);
  return {
    filePath: 'App.tsx',
    line: entry.line,
    column: entry.column,
    anchor: pathToAnchor(entry.path),
  };
}

const ROW = `export function App() {
  return (
    <div className="flex gap-4">
      <div className="w-40">第一张</div>
      <div className="w-40">第二张</div>
      <div className="w-40">第三张</div>
    </div>
  );
}
`;

const ROW_MOVED = `export function App() {
  return (
    <div className="flex gap-4">
      <div className="w-40">第二张</div>
      <div className="w-40">第三张</div>
      <div className="w-40">第一张</div>
    </div>
  );
}
`;

describe('拖拽重排（内核）', () => {
  it('把第一项移到最后：结果与"人工调换三行"逐字节相同', () => {
    const result = applyLayoutOp(ROW, locatorByToken(ROW, 'flex'), {
      kind: 'childOrder',
      to: [1, 2, 0],
      expectItems: 3,
    });

    expect(result.status).toBe('ok');
    expect(result.code).toBe(ROW_MOVED);
    // 差值就是三行，别的一字未动
    const before = ROW.split('\n');
    const after = result.code!.split('\n');
    expect(after).toHaveLength(before.length);
  });

  it('产物不含任何绝对定位或 order-N 类', () => {
    const result = applyLayoutOp(ROW, locatorByToken(ROW, 'flex'), {
      kind: 'childOrder',
      to: [1, 2, 0],
      expectItems: 3,
    });
    expect(auditLayoutSafety(result.code!).violations).toEqual([]);
    expect(result.code!).not.toMatch(/\b(absolute|fixed)\b/);
    expect(result.code!).not.toMatch(/\border-\d/);
  });

  it('网格布局也支持重排（document order 决定网格落位）', () => {
    const grid = `export function Grid() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>a</div>
      <div>b</div>
      <div>c</div>
      <div>d</div>
    </div>
  );
}
`;
    const result = applyLayoutOp(grid, locatorByToken(grid, 'grid-cols-2'), {
      kind: 'childOrder',
      to: [2, 3, 0, 1],
      expectItems: 4,
    });

    expect(result.status).toBe('ok');
    const order = ['c', 'd', 'a', 'b'].map((ch) => result.code!.indexOf(`>${ch}<`));
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it('顺序没变时不产生任何改动', () => {
    const result = applyLayoutOp(ROW, locatorByToken(ROW, 'flex'), {
      kind: 'childOrder',
      to: [0, 1, 2],
      expectItems: 3,
    });
    expect(result.status).toBe('ok');
    expect(result.changed).toBe(false);
  });

  it('DOM 项数与源码子项数不一致：拒绝，避免改错元素', () => {
    const result = applyLayoutOp(ROW, locatorByToken(ROW, 'flex'), {
      kind: 'childOrder',
      to: [1, 2, 0],
      expectItems: 4,
    });
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('索引对不上');
    expect(result.code).toBeUndefined();
  });

  it('含实际文本的容器：拒绝重排（会改变语义）', () => {
    const mixed = `export function Mixed() {
  return (
    <div className="flex">
      说明文字
      <span>a</span>
      <span>b</span>
    </div>
  );
}
`;
    const result = applyLayoutOp(mixed, locatorByToken(mixed, 'flex'), {
      kind: 'childOrder',
      to: [1, 0],
      expectItems: 2,
    });
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('实际文本');
  });
});
