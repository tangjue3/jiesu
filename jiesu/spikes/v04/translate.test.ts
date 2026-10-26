/**
 * 拖拽位移的内核测试：px ↔ Tailwind translate 类。
 *
 * 核心命题：拖动只往 class 里加位移类，**永远不产出坐标**，
 * 且其余 token 逐字节不变。
 */
import { describe, expect, it } from 'vitest';

import { applyOp } from '../../src/core/write/apply';
import { auditLayoutSafety } from '../../src/core/layout/guard';
import {
  parseTranslate,
  setTranslate,
  snapPx,
  translateClass,
} from '../../src/core/write/translate';
import { collectJsxTree, pathToAnchor } from '../../src/core/locate/jsx-tree';
import type { ElementLocator } from '../../src/core/locate/parse';

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

describe('像素 ↔ 位移类', () => {
  it('吸附到 4px 刻度（拖拽时所见即所得）', () => {
    expect(snapPx(6)).toBe(8);
    expect(snapPx(5)).toBe(4);
    expect(snapPx(-6)).toBe(-8);
    expect(snapPx(0)).toBe(0);
    expect(snapPx(Number.NaN)).toBe(0);
  });

  it('正负都能生成合法类名', () => {
    expect(translateClass('x', 24)).toBe('translate-x-6');
    expect(translateClass('y', -8)).toBe('-translate-y-2');
    expect(translateClass('x', 0)).toBeNull();
    expect(translateClass('x', 6)).toBeNull(); // 非 4 的倍数，绝不写脏值
  });

  it('从 class 列表读回当前位移', () => {
    expect(parseTranslate(['flex', 'translate-x-6', '-translate-y-2', 'gap-4'])).toEqual({
      x: 24,
      y: -8,
    });
  });

  it('读回时忽略变体前缀（md:translate-x-4 不算 base 位移）', () => {
    expect(parseTranslate(['md:translate-x-4', 'translate-y-1'])).toEqual({ x: 0, y: 4 });
  });

  it('认不出的刻度不猜', () => {
    expect(parseTranslate(['translate-x-[37px]'])).toEqual({ x: 0, y: 0 });
  });
});

describe('class 文本改写', () => {
  it('原本没有位移：追加到末尾', () => {
    const result = setTranslate('flex items-center gap-4', 24, 0);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('flex items-center gap-4 translate-x-6');
  });

  it('已有位移：原地替换，其余 token 一字不动', () => {
    const result = setTranslate('flex translate-x-2 gap-4 translate-y-1', 24, 0);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('flex translate-x-6 gap-4');
  });

  it('归零：把位移类删干净，不留双空格', () => {
    const result = setTranslate('flex translate-x-2 gap-4 translate-y-1', 0, 0);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('flex gap-4');
  });

  it('没有任何变化时不产生修改', () => {
    const result = setTranslate('flex gap-4', 0, 0);
    expect(result.changed).toBe(false);
  });

  it('已在目标值上：不产生修改', () => {
    const result = setTranslate('flex translate-x-6', 24, 0);
    expect(result.changed).toBe(false);
  });

  it('空 class：只写位移类', () => {
    expect(setTranslate('', 8, -8).text).toBe('translate-x-2 -translate-y-2');
  });
});

describe('写回源码', () => {
  const SOURCE = `export function App() {
  return (
    <div className="flex gap-4">
      <button className="rounded-md bg-blue-600 px-3 py-1 text-white">操作</button>
    </div>
  );
}
`;

  it('拖 24px：只往 className 里加一个位移类', () => {
    const result = applyOp(SOURCE, locatorByToken(SOURCE, 'rounded-md'), {
      kind: 'translate',
      xPx: 24,
      yPx: 0,
    });

    expect(result.status).toBe('ok');
    expect(result.changed).toBe(true);
    expect(result.code).toContain(
      'className="rounded-md bg-blue-600 px-3 py-1 text-white translate-x-6"',
    );
    // 除这一处外一字未动
    expect(result.code!.replace(' translate-x-6', '')).toBe(SOURCE);
  });

  it('产物里没有任何定位属性（位移仍在文档流里）', () => {
    const result = applyOp(SOURCE, locatorByToken(SOURCE, 'rounded-md'), {
      kind: 'translate',
      xPx: 24,
      yPx: -12,
    });
    const code = result.code!;
    expect(auditLayoutSafety(code).violations).toEqual([]);
    expect(code).not.toMatch(/\b(absolute|fixed)\b/);
    expect(code).not.toMatch(/\b(position|left|top|inset)\s*:/);
    // 位移是语义化的类，不是坐标
    expect(code).toContain('translate-x-6');
    expect(code).toContain('-translate-y-3');
  });

  it('拖回原位：位移类被清掉，源码回到原样', () => {
    const moved = applyOp(SOURCE, locatorByToken(SOURCE, 'rounded-md'), {
      kind: 'translate',
      xPx: 24,
      yPx: 0,
    });
    const back = applyOp(moved.code!, locatorByToken(moved.code!, 'rounded-md'), {
      kind: 'translate',
      xPx: 0,
      yPx: 0,
    });
    expect(back.status).toBe('ok');
    expect(back.code).toBe(SOURCE);
  });

  it('模板拼接的 className：明确拒绝，不猜', () => {
    const dynamic = `export function App() {
  return <div className={\`flex \${extra}\`}>x</div>;
}
`;
    // 模板串没有静态 token 可查，直接按标签名取定位
    const entry = collectJsxTree(dynamic).find(
      (item) => item.opening.name.type === 'JSXIdentifier' && item.opening.name.name === 'div',
    );
    if (!entry) throw new Error('找不到 div');
    const locator: ElementLocator = {
      filePath: 'App.tsx',
      line: entry.line,
      column: entry.column,
      anchor: pathToAnchor(entry.path),
    };

    const result = applyOp(dynamic, locator, { kind: 'translate', xPx: 8, yPx: 0 });
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('模板拼接');
    expect(result.code).toBeUndefined();
  });
});
