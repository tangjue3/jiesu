import { describe, expect, it } from 'vitest';

import {
  dragModeFromDisplay,
  exceededThreshold,
  gridIndicator,
  insertionIndexGrid,
  insertionIndexLinear,
  isOutside,
  linearIndicator,
  planReorder,
  type Rect,
} from '../../src/client/drag';

const r = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
});

/** 一排 3 张卡片，宽度 80、间距 20。 */
const ROW: Rect[] = [r(0, 0, 80, 100), r(100, 0, 80, 100), r(200, 0, 80, 100)];
/** 一列 3 项。 */
const COL: Rect[] = [r(0, 0, 100, 40), r(0, 50, 100, 40), r(0, 100, 100, 40)];
/** 2×2 网格。 */
const GRID: Rect[] = [
  r(0, 0, 100, 100),
  r(110, 0, 100, 100),
  r(0, 110, 100, 100),
  r(110, 110, 100, 100),
];

describe('拖拽模式判定', () => {
  it('flex 判定横竖方向', () => {
    expect(dragModeFromDisplay('flex', 'row')).toEqual({ kind: 'linear', axis: 'x' });
    expect(dragModeFromDisplay('flex', 'row-reverse')).toEqual({ kind: 'linear', axis: 'x' });
    expect(dragModeFromDisplay('inline-flex', 'column')).toEqual({ kind: 'linear', axis: 'y' });
  });

  it('grid 走二维', () => {
    expect(dragModeFromDisplay('grid', 'row')).toEqual({ kind: 'grid' });
    expect(dragModeFromDisplay('inline-grid', 'row')).toEqual({ kind: 'grid' });
  });

  it('其它布局明确不支持，而不是猜', () => {
    expect(dragModeFromDisplay('block', 'row')).toBeNull();
    expect(dragModeFromDisplay('table', 'row')).toBeNull();
    expect(dragModeFromDisplay('contents', 'row')).toBeNull();
  });
});

describe('一维插入位置', () => {
  it('落在第一张卡片前半 → 插到最前', () => {
    expect(insertionIndexLinear(ROW, 'x', { x: 10, y: 50 })).toBe(0);
  });

  it('落在第一张卡片后半 → 插到第二张之前', () => {
    // 卡片 0 中心 = 40
    expect(insertionIndexLinear(ROW, 'x', { x: 60, y: 50 })).toBe(1);
  });

  it('越过最后一张 → 插到最后', () => {
    expect(insertionIndexLinear(ROW, 'x', { x: 500, y: 50 })).toBe(3);
  });

  it('纵向容器按 y 比较', () => {
    expect(insertionIndexLinear(COL, 'y', { x: 10, y: 5 })).toBe(0);
    expect(insertionIndexLinear(COL, 'y', { x: 10, y: 45 })).toBe(1);
    expect(insertionIndexLinear(COL, 'y', { x: 10, y: 300 })).toBe(3);
  });
});

describe('二维（grid）插入位置', () => {
  it('第一格前半 → 最前', () => {
    expect(insertionIndexGrid(GRID, { x: 20, y: 20 })).toBe(0);
  });

  it('第一格后半 → 第二格之前', () => {
    expect(insertionIndexGrid(GRID, { x: 80, y: 20 })).toBe(1);
  });

  it('第二行第一格前半 → 第三项之前', () => {
    expect(insertionIndexGrid(GRID, { x: 20, y: 130 })).toBe(2);
  });

  it('全部下方 → 最后', () => {
    expect(insertionIndexGrid(GRID, { x: 20, y: 400 })).toBe(4);
  });
});

describe('顺序翻译', () => {
  it('第一项拖到最后', () => {
    expect(planReorder(3, 0, 3)).toEqual({ order: [1, 2, 0], noop: false });
  });

  it('最后一项拖到最前', () => {
    expect(planReorder(3, 2, 0)).toEqual({ order: [2, 0, 1], noop: false });
  });

  it('中间项拖到最前', () => {
    expect(planReorder(3, 1, 0)).toEqual({ order: [1, 0, 2], noop: false });
  });

  it('插到自己前面或紧跟后面 → 视为没有变化', () => {
    expect(planReorder(3, 1, 1)?.noop).toBe(true);
    expect(planReorder(3, 1, 2)?.noop).toBe(true);
    expect(planReorder(3, 0, 0)?.noop).toBe(true);
    expect(planReorder(3, 2, 3)?.noop).toBe(true);
  });

  it('无序返回 null，绝不瞎排', () => {
    expect(planReorder(3, -1, 0)).toBeNull();
    expect(planReorder(3, 3, 0)).toBeNull();
    expect(planReorder(3, 0, 4)).toBeNull();
  });
});

describe('插入指示线', () => {
  it('横排画竖线，贯穿整行高度', () => {
    const line = linearIndicator(ROW, 'x', 1)!;
    expect(line.top).toBe(0);
    expect(line.height).toBe(100);
    expect(line.width).toBe(3);
    // 贴在第二张卡片左边缘外侧
    expect(line.left).toBe(98);
  });

  it('插到末端时贴在最后一项右侧', () => {
    const line = linearIndicator(ROW, 'x', 3)!;
    expect(line.left).toBe(282);
  });

  it('竖排画横线', () => {
    const line = linearIndicator(COL, 'y', 1)!;
    expect(line.height).toBe(3);
    expect(line.top).toBe(48);
  });

  it('网格指示线只占目标那一格的高度', () => {
    const line = gridIndicator(GRID, 2)!;
    expect(line.height).toBe(100);
    expect(line.top).toBe(110);
    expect(line.left).toBe(-2);
  });
});

describe('边界与阈值', () => {
  it('明显离开容器才算跨容器拖拽', () => {
    const box = r(0, 0, 300, 100);
    expect(isOutside(box, { x: 150, y: 50 })).toBe(false);
    expect(isOutside(box, { x: 310, y: 50 })).toBe(false); // 容差内
    expect(isOutside(box, { x: 400, y: 50 })).toBe(true);
    expect(isOutside(box, { x: 150, y: 200 })).toBe(true);
  });

  it('位移超过阈值才算拖拽（否则仍是点击选中）', () => {
    expect(exceededThreshold({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
    expect(exceededThreshold({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(true);
  });
});
