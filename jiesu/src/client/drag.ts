/**
 * 拖拽重排的几何计算（纯函数，不碰 DOM）。
 *
 * 核心纪律：拖拽**只改变同级顺序**，绝不产生任何绝对定位。
 * 所以这里只负责回答一个问题——"松手后应该插到第几个位置"，
 * 落地由 core/layout 的结构级重排（移动 JSX 节点）完成。
 *
 * 插入位置的语义：0..n 的**边界序号**，表示"插到第 index 项之前"。
 *   - 0     → 最前面
 *   - n     → 最后面
 *   - from 或 from+1 → 视觉上没有变化（自己插到自己前后）
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 一维排列的方向：x = 横向（flex-row），y = 纵向（flex-col） */
export type DragAxis = 'x' | 'y';

/** 拖拽模式：一维（flex）或二维（grid） */
export type DragMode = { kind: 'linear'; axis: DragAxis } | { kind: 'grid' };

/**
 * 从 computed style 决定拖拽模式。
 *
 * 只支持 flex / grid —— 其它布局（block、inline、table）里"拖动改顺序"
 * 没有可靠的语义，宁可明确不支持，也不要猜。
 */
export function dragModeFromDisplay(display: string, flexDirection: string): DragMode | null {
  if (display === 'flex' || display === 'inline-flex') {
    return { kind: 'linear', axis: flexDirection.startsWith('row') ? 'x' : 'y' };
  }
  if (display === 'grid' || display === 'inline-grid') {
    return { kind: 'grid' };
  }
  return null;
}

/**
 * 一维插入位置：数一下有多少项的中心在指针之前。
 *
 * 为什么用中心而不是边缘：指针落在某一项的前半 → 插到它前面；
 * 后半 → 插到它后面。这与用户直觉一致。
 */
export function insertionIndexLinear(rects: Rect[], axis: DragAxis, pointer: Point): number {
  const value = axis === 'x' ? pointer.x : pointer.y;
  let index = 0;
  for (const rect of rects) {
    const center = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    if (value > center) index += 1;
  }
  return index;
}

/**
 * 二维（grid）插入位置：按行主序（左→右、上→下）比较。
 *
 * 指针在某一行上方 → 插到该行第一项之前；
 * 在行内 → 按水平中线决定前后；
 * 在所有行下方 → 插到最后。
 */
export function insertionIndexGrid(rects: Rect[], pointer: Point): number {
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    if (pointer.y < rect.top) return i;
    if (pointer.y > rect.top + rect.height) continue;
    if (pointer.x < rect.left + rect.width / 2) return i;
  }
  return rects.length;
}

export interface ReorderPlan {
  /** 新的顺序（元素原始序号数组），直接交给 childOrder */
  order: number[];
  /** 是否等于原顺序（无需写回） */
  noop: boolean;
}

/** 把"从 from 拖到 insertAt"翻译成新的顺序数组。 */
export function planReorder(itemCount: number, from: number, insertAt: number): ReorderPlan | null {
  if (!Number.isInteger(itemCount) || itemCount < 0) return null;
  if (!Number.isInteger(from) || from < 0 || from >= itemCount) return null;
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > itemCount) return null;

  const identity = Array.from({ length: itemCount }, (_, i) => i);
  // 插到自己前面或紧跟自己后面 → 顺序不变
  if (insertAt === from || insertAt === from + 1) {
    return { order: identity, noop: true };
  }

  const rest = identity.filter((i) => i !== from);
  // 从原位置移除后，目标边界要左移一位
  rest.splice(insertAt > from ? insertAt - 1 : insertAt, 0, from);
  return { order: rest, noop: false };
}

const LINE = 3;

/** 一维插入指示线（横排画竖线，竖排画横线）。 */
export function linearIndicator(rects: Rect[], axis: DragAxis, insertAt: number): Rect | null {
  if (rects.length === 0) return null;
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.left + r.width));

  if (axis === 'x') {
    const x =
      insertAt >= rects.length
        ? right + 2
        : Math.max(left - 2, rects[Math.max(0, insertAt)].left - 2);
    return { left: x, top, width: LINE, height: bottom - top };
  }

  const y =
    insertAt >= rects.length
      ? bottom + 2
      : Math.max(top - 2, rects[Math.max(0, insertAt)].top - 2);
  return { left, top: y, width: right - left, height: LINE };
}

/** 网格插入指示线：贴在第 insertAt 项的左边缘，高度跟该行一致。 */
export function gridIndicator(rects: Rect[], insertAt: number): Rect | null {
  if (rects.length === 0) return null;
  if (insertAt >= rects.length) {
    const last = rects[rects.length - 1];
    return { left: last.left + last.width + 2, top: last.top, width: LINE, height: last.height };
  }
  const target = rects[insertAt];
  return { left: target.left - 2, top: target.top, width: LINE, height: target.height };
}

/** 指针是否已经明显离开容器（跨容器拖拽不在支持范围内）。 */
export function isOutside(container: Rect, pointer: Point, tolerance = 24): boolean {
  return (
    pointer.x < container.left - tolerance ||
    pointer.x > container.left + container.width + tolerance ||
    pointer.y < container.top - tolerance ||
    pointer.y > container.top + container.height + tolerance
  );
}

/** 拖拽位移是否超过点击阈值。 */
export function exceededThreshold(start: Point, current: Point, threshold = 5): boolean {
  return Math.abs(current.x - start.x) > threshold || Math.abs(current.y - start.y) > threshold;
}
