import { describe, expect, it } from 'vitest';

import { applyLayoutOp } from '../../src/core/layout/apply-layout';
import { auditLayoutSafety } from '../../src/core/layout/guard';
import {
  classTokens,
  flexParent,
  gridParent,
  locateByClassToken,
  readFixture,
} from './helpers';

/** 断言：产物里绝不出现绝对定位类或绝对定位样式。 */
function expectNoAbsolutePositioning(code: string) {
  const audit = auditLayoutSafety(code);
  expect(audit.violations).toEqual([]);
  expect(audit.ok).toBe(true);
  expect(code).not.toMatch(/\b(absolute|fixed)\b/);
  expect(code).not.toMatch(/\b(position|left|right|top|bottom|inset)\s*:/);
  expect(code).not.toMatch(/\b(left|right|top|bottom|inset|translate)-/);
}

/** 断言：除目标族外，其它 class token 完全不变。 */
function expectOnlyFamilyChanged(code: string, before: string, changed: string[]) {
  const beforeTokens = classTokens(before).filter((t) => !changed.includes(t));
  const afterTokens = classTokens(code).filter((t) => !changed.includes(t));
  expect(afterTokens.sort()).toEqual(beforeTokens.sort());
}

describe('S4 · 布局语义编辑', () => {
  it('导航栏：flex 方向 row → column，不写绝对定位', () => {
    const code = readFixture('navbar.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'justify-between'),
      { kind: 'flexDirection', to: 'flex-col' },
    );

    expect(result.status).toBe('ok');
    expect(result.changed).toBe(true);
    // 只有目标容器被改：nav 变成 flex-col，内部的 flex 容器保持不变
    expect(result.code).toContain(
      '<nav className="flex-col items-center justify-between gap-4 px-6 py-4">',
    );
    expect(result.code).toContain('<div className="flex items-center gap-3">');
    expectNoAbsolutePositioning(result.code!);
    expectOnlyFamilyChanged(result.code!, code, ['flex', 'flex-col']);
  });

  it('导航栏：flex 方向 column → row 时保留 `flex` 而非改成 flex-row', () => {
    const code = readFixture('navbar.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'justify-between'),
      { kind: 'flexDirection', to: 'flex-row' },
    );
    expect(result.status).toBe('ok');
    // flex 与 flex-row 语义等价，不做无意义改写
    expect(result.changed).toBe(false);
  });

  it('卡片网格：改列数 grid-cols-3 → grid-cols-2', () => {
    const code = readFixture('card-grid.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'grid-cols-3'),
      { kind: 'gridCols', to: 2 },
    );

    expect(result.status).toBe('ok');
    expect(classTokens(result.code!)).toContain('grid-cols-2');
    expect(classTokens(result.code!)).not.toContain('grid-cols-3');
    expectNoAbsolutePositioning(result.code!);
    expectOnlyFamilyChanged(result.code!, code, ['grid-cols-3', 'grid-cols-2']);
  });

  it('表单：gap 16px → 24px（px 语义 → Tailwind 类）', () => {
    const code = readFixture('contact-form.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'max-w-md'),
      { kind: 'gap', toPx: 24 },
    );

    expect(result.status).toBe('ok');
    expect(classTokens(result.code!)).toContain('gap-6');
    expect(classTokens(result.code!)).not.toContain('gap-4');
    expectNoAbsolutePositioning(result.code!);
    expectOnlyFamilyChanged(result.code!, code, ['gap-4', 'gap-6']);
  });

  it('Hero：子项 col-span-7 → col-span-8（网格语义）', () => {
    const code = readFixture('hero.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'col-span-7'),
      { kind: 'gridColumn', to: { span: 8 } },
      gridParent(),
    );

    expect(result.status).toBe('ok');
    expect(result.code).toContain('col-span-8');
    expect(result.code).not.toContain('col-span-7');
    expectNoAbsolutePositioning(result.code!);
  });

  it('侧边栏：重排子项（移动 JSX 节点而非加 order 类），缩进保持不变', () => {
    const code = readFixture('sidebar.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'min-h-screen'),
      { kind: 'childOrder', to: [1, 0] },
      flexParent(),
    );

    expect(result.status).toBe('ok');
    expect(result.changed).toBe(true);

    const updated = result.code!;
    const mainAt = updated.indexOf('<main');
    const asideAt = updated.indexOf('<aside');
    expect(mainAt).toBeGreaterThan(-1);
    expect(asideAt).toBeGreaterThan(-1);
    // main 现在排在 aside 前面
    expect(mainAt).toBeLessThan(asideAt);

    // 没有引入 order 类
    expect(classTokens(updated).some((t) => t.startsWith('order-'))).toBe(false);
    expectNoAbsolutePositioning(updated);

    // 缩进结构保持：两个元素的缩进都是 6 空格
    expect(updated).toContain('\n      <main className="flex-1 p-6">');
    expect(updated).toContain('\n      <aside className="w-64 shrink-0');
  });

  it('父容器不是 grid 时改网格属性：明确拒绝，不硬塞类', () => {
    const code = readFixture('navbar.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'justify-between'),
      { kind: 'gridColumn', to: { span: 2 } },
      flexParent(),
    );

    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('不是 grid 布局');
    expect(result.code).toBeUndefined();
  });

  it('无法确定父容器布局时：拒绝并说明原因', () => {
    const code = readFixture('navbar.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'justify-between'),
      { kind: 'gridColumn', to: { span: 2 } },
    );

    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('无法确定父容器');
    expect(result.code).toBeUndefined();
  });

  it('容器没有设置对齐方式时：拒绝擅自新增', () => {
    const code = readFixture('contact-form.tsx');
    // label 是 flex 容器，但没有 items-* 类
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'gap-2'),
      { kind: 'alignItems', to: 'items-center' },
    );

    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('交叉轴对齐');
    expect(result.code).toBeUndefined();
  });

  it('断点变体：只改 md 断点的类，不动 base', () => {
    const code = readFixture('hero.tsx');
    const withVariant = code.replace(
      'grid grid-cols-12',
      'grid grid-cols-12 md:grid-cols-6',
    );
    const result = applyLayoutOp(
      withVariant,
      locateByClassToken(withVariant, 'md:grid-cols-6'),
      { kind: 'gridCols', to: 4, variant: 'md:' },
    );

    expect(result.status).toBe('ok');
    const tokens = classTokens(result.code!);
    expect(tokens).toContain('md:grid-cols-4');
    expect(tokens).toContain('grid-cols-12');
    expect(tokens).not.toContain('md:grid-cols-6');
    expectNoAbsolutePositioning(result.code!);
  });

  it('重排非法顺序：明确拒绝', () => {
    const code = readFixture('sidebar.tsx');
    const result = applyLayoutOp(
      code,
      locateByClassToken(code, 'min-h-screen'),
      { kind: 'childOrder', to: [0, 0] },
      flexParent(),
    );

    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('重复');
    expect(result.code).toBeUndefined();
  });
});
