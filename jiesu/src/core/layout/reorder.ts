import type { JSXElement } from '@babel/types';

export interface ReorderEdit {
  start: number;
  end: number;
  before: string;
  after: string;
}

export interface ReorderResult {
  ok: boolean;
  reason?: string;
  edit?: ReorderEdit;
  itemCount: number;
}

/**
 * 重排 JSX 子项顺序 —— 布局语义编辑里最"真"的一个操作。
 *
 * 与"加 order-N 类"不同，移动 JSX 节点改变的是**文档顺序**，
 * 这对 SSR、无 JS 场景、读屏顺序都是正确的做法。
 *
 * 关键技巧：**空白段固定不动，只把项按新顺序填回原槽位**，
 * 因此缩进与换行结构 100% 保留。
 */
export function reorderJsxChildren(
  code: string,
  parent: JSXElement,
  order: number[],
): ReorderResult {
  const children = parent.children;

  // 1. 分离空白与项
  const items: Array<{ start: number; end: number }> = [];
  for (const child of children) {
    if (child.type === 'JSXText') {
      if (child.value.trim().length > 0) {
        return {
          ok: false,
          reason: '容器内含有实际文本内容，重排会改变语义，已拒绝',
          itemCount: 0,
        };
      }
      continue;
    }
    const start = child.start;
    const end = child.end;
    if (typeof start !== 'number' || typeof end !== 'number') {
      return { ok: false, reason: '子节点缺少位置信息，无法安全重排', itemCount: 0 };
    }
    items.push({ start, end });
  }

  const n = items.length;
  if (n === 0) {
    return { ok: false, reason: '容器内没有可重排的子项', itemCount: 0 };
  }

  // 2. 校验排列合法性
  if (order.length !== n) {
    return {
      ok: false,
      reason: `目标顺序有 ${order.length} 项，但容器内有 ${n} 个子项`,
      itemCount: n,
    };
  }
  const seen = new Set<number>();
  for (const idx of order) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
      return { ok: false, reason: `目标顺序包含非法序号 ${idx}`, itemCount: n };
    }
    if (seen.has(idx)) {
      return { ok: false, reason: `目标顺序包含重复序号 ${idx}`, itemCount: n };
    }
    seen.add(idx);
  }

  // 3. 抽取各槽位之间的空白段（第 i 个槽位与第 i+1 个槽位之间）
  const gaps: string[] = [];
  for (let i = 1; i < n; i += 1) {
    gaps.push(code.slice(items[i - 1].end, items[i].start));
  }

  const texts = items.map((item) => code.slice(item.start, item.end));

  // 4. 按新顺序填回原槽位（空白不动）
  const pieces: string[] = [];
  for (let slot = 0; slot < n; slot += 1) {
    pieces.push(texts[order[slot]]);
    if (slot < n - 1) pieces.push(gaps[slot]);
  }

  const start = items[0].start;
  const end = items[n - 1].end;
  const before = code.slice(start, end);
  const after = pieces.join('');

  if (before === after) {
    return { ok: true, itemCount: n };
  }

  return {
    ok: true,
    itemCount: n,
    edit: { start, end, before, after },
  };
}
