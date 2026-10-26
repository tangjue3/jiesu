import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyOp, type ApplyResult, type StyleOp } from '../../src/core/write/apply';
import { classifyBaseClass } from '../../src/core/write/tailwind-classes';
import { pxToTailwindClass, pxToSpacingScale } from '../../src/core/write/units';
import { locateByClassToken, locateByLine, locateByStyleProp, locateByText } from '../_shared/jsx-fixture';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const original = (name: string) => readFileSync(join(FIXTURES, 'original', name), 'utf8');
const expected = (name: string) => readFileSync(join(FIXTURES, 'expected', name), 'utf8');

function apply(name: string, op: StyleOp, locate: (code: string) => any): ApplyResult {
  const code = original(name);
  return applyOp(code, locate(code), op);
}

/** golden test：输出必须与人工预期的期望文件逐字节相同，且 diff 只落在一行。 */
function expectGolden(result: ApplyResult, name: string): void {
  expect(result.status).toBe('ok');
  expect(result.changed).toBe(true);
  expect(result.code).toBe(expected(name));
  expect(result.diff).toBeDefined();
  expect(result.diff!.startLine).toBe(result.diff!.endLine);
}

describe('S2 · 确定性写回', () => {
  it('静态 className：只改目标 token，其它类与格式完全不动', () => {
    const result = apply(
      'f1-static-classname.tsx',
      { kind: 'class', category: 'spacing', fromBase: 'p-4', toBase: 'p-6' },
      (code) => locateByClassToken(code, 'rounded-lg'),
    );
    expectGolden(result, 'f1-static-classname.tsx');
    expect(result.matched).toBe(1);
  });

  it('模板字面量：跨行模板的内部格式被完整保留', () => {
    const result = apply(
      'f2-template-literal.tsx',
      { kind: 'class', category: 'spacing', fromBase: 'px-3', toBase: 'px-4' },
      (code) => locateByClassToken(code, 'rounded-full'),
    );
    expectGolden(result, 'f2-template-literal.tsx');
  });

  it('cn() 生成的 className：明确拒绝，而不是猜', () => {
    const result = apply(
      'f3-cn-call.tsx',
      { kind: 'class', category: 'spacing', fromBase: 'px-2', toBase: 'px-3' },
      (code) => locateByLine(code, 5),
    );
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('函数调用');
    expect(result.code).toBeUndefined();
  });

  it('条件表达式生成的 className：明确拒绝', () => {
    const result = apply(
      'f4-conditional.tsx',
      { kind: 'class', category: 'spacing', fromBase: 'p-4', toBase: 'p-6' },
      (code) => locateByLine(code, 2),
    );
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('条件表达式');
  });

  it('多实例：改使用处只影响该实例，组件定义与其它实例不变', () => {
    const result = apply(
      'f5-multi-instance.tsx',
      { kind: 'class', category: 'spacing', fromBase: 'px-4', toBase: 'px-6' },
      (code) => locateByClassToken(code, 'px-4'),
    );
    expectGolden(result, 'f5-multi-instance.tsx');
    expect(result.matched).toBe(1);
  });

  it('inline style：改 style 对象里的单个属性，保留引号风格', () => {
    const result = apply(
      'f6-inline-style.tsx',
      { kind: 'inlineStyle', prop: 'padding', to: '24px' },
      (code) => locateByStyleProp(code, 'padding'),
    );
    expectGolden(result, 'f6-inline-style.tsx');
  });

  it('文本节点：直接改 JSX 文本', () => {
    const result = apply(
      'f7-text-node.tsx',
      { kind: 'text', to: '开始探索' },
      (code) => locateByText(code, '欢迎使用我们的产品'),
    );
    expectGolden(result, 'f7-text-node.tsx');
  });

  it('同类别多个类：改 p-2 不影响 px-4 / py-1', () => {
    const result = apply(
      'f8-multiple-same-category.tsx',
      { kind: 'class', category: 'spacing', fromBase: 'p-2', toBase: 'p-3' },
      (code) => locateByClassToken(code, 'gap-2'),
    );
    expectGolden(result, 'f8-multiple-same-category.tsx');
  });

  it('px 语义操作：16px → 24px 映射为 p-4 → p-6', () => {
    const result = apply(
      'f1-static-classname.tsx',
      { kind: 'classByPx', category: 'spacing', prefix: 'p', fromPx: 16, toPx: 24 },
      (code) => locateByClassToken(code, 'rounded-lg'),
    );
    expect(result.status).toBe('ok');
    expect(result.code).toContain('p-6');
  });

  it('px 语义操作：只改指定类族，不误伤 px-4 / py-1', () => {
    const result = apply(
      'f8-multiple-same-category.tsx',
      { kind: 'classByPx', category: 'spacing', prefix: 'p', fromPx: 8, toPx: 12 },
      (code) => locateByClassToken(code, 'gap-2'),
    );
    expect(result.status).toBe('ok');
    expect(result.code).toContain('p-3');
    expect(result.code).toContain('px-4');
    expect(result.code).toContain('py-1');
    expect(result.matched).toBe(1);
  });

  it('px 无法映射到离散刻度时：明确拒绝', () => {
    const result = apply(
      'f1-static-classname.tsx',
      { kind: 'classByPx', category: 'spacing', prefix: 'p', fromPx: 16, toPx: 13 },
      (code) => locateByClassToken(code, 'rounded-lg'),
    );
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('13px');
  });
});

describe('S2 · 分类器与单位', () => {
  it('区分字号与颜色（text-sm vs text-white）', () => {
    expect(classifyBaseClass('text-sm')).toBe('fontSize');
    expect(classifyBaseClass('text-white')).toBe('color');
    expect(classifyBaseClass('text-slate-900')).toBe('color');
  });

  it('区分间距族、尺寸族与布局', () => {
    expect(classifyBaseClass('p-4')).toBe('spacing');
    expect(classifyBaseClass('px-4')).toBe('spacing');
    expect(classifyBaseClass('gap-2')).toBe('spacing');
    expect(classifyBaseClass('w-1/2')).toBe('size');
    expect(classifyBaseClass('h-10')).toBe('size');
    expect(classifyBaseClass('flex')).toBe('layout');
    expect(classifyBaseClass('items-center')).toBe('layout');
    expect(classifyBaseClass('col-span-2')).toBe('layout');
  });

  it('区分圆角、边框宽度与边框颜色、阴影', () => {
    expect(classifyBaseClass('rounded-lg')).toBe('radius');
    expect(classifyBaseClass('border-2')).toBe('borderWidth');
    expect(classifyBaseClass('border-red-500')).toBe('color');
    expect(classifyBaseClass('shadow-md')).toBe('shadow');
  });

  it('px 与 Tailwind 刻度互转', () => {
    expect(pxToSpacingScale(16)).toBe('4');
    expect(pxToSpacingScale(24)).toBe('6');
    expect(pxToSpacingScale(2)).toBe('0.5');
    expect(pxToSpacingScale(13)).toBeNull();
    expect(pxToTailwindClass('spacing', 'p', 24)).toBe('p-6');
    expect(pxToTailwindClass('spacing', 'px', 12)).toBe('px-3');
  });
});
