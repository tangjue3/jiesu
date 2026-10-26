import type { JSXElement, JSXOpeningElement } from '@babel/types';

import { collectJsxTree, pathToAnchor, type JsxTreeEntry } from './jsx-tree.js';

/**
 * 元素在源码中的位置。
 *
 * 两个锚点：
 *  - line/column 精确锚点：编译期注入的 data-jiesu-src，精确但**会漂移**
 *  - anchor 结构锚点：JSX 层级路径，**不漂移**但结构变了就失效
 *
 * 两者交叉使用：任何一个单独用都会出错，合起来才能既防漂移又防误伤。
 */
export interface ElementLocator {
  filePath: string;
  line: number;
  column: number;
  /** 结构锚点，如 "0.1" */
  anchor?: string;
}

/** 一个文件的 JSX 元素集合。 */
export type JsxTree = JsxTreeEntry[];

/**
 * 统一解析入口：TS + TSX，容错模式。
 * 只收集 JSX 元素，不保留整棵 AST —— 我们需要的只是元素、它的父节点和路径。
 */
export function parseSource(code: string): JsxTree {
  return collectJsxTree(code);
}

export type LocateResult =
  | {
      ok: true;
      element: JSXOpeningElement;
      /** 元素本体（改文本时要用它的 children） */
      jsx: JSXElement;
      parent: JSXElement | null;
      /** 命中的元素在 JSX 树中的路径 */
      path: JsxTreeEntry['path'];
      matchedBy: 'exact' | 'line' | 'anchor';
    }
  | { ok: false; reason: string };

/**
 * 按位置找到 JSX 元素。
 *
 * 定位策略（按可靠性排序）：
 *  1. **双锚点一致** → 直接命中，最可信
 *  2. **双锚点冲突** → 该行唯一则采信行号，否则明确拒绝
 *  3. **只有结构锚点** → 用结构锚点定位（行号已漂移，但结构没变）
 *  4. **只有行号** → 退化为"同一行唯一元素"
 *  5. 都不行 → 明确拒绝
 *
 * 关键纪律：**绝不"猜"**。宁可让用户重新点一次，也不改错元素。
 */
export function findJsxElement(tree: JsxTree, locator: ElementLocator): LocateResult {
  if (tree.length === 0) return { ok: false, reason: '文件中没有 JSX 元素' };

  const byAnchor = locator.anchor
    ? tree.find((entry) => pathToAnchor(entry.path) === locator.anchor)
    : undefined;
  const byLine = tree.find(
    (entry) => entry.line === locator.line && entry.column === locator.column,
  );
  const nearLine = tree.find(
    (entry) => entry.line === locator.line && Math.abs(entry.column - locator.column) === 1,
  );
  const sameLine = tree.filter((entry) => entry.line === locator.line);

  const toResult = (
    entry: JsxTreeEntry,
    matchedBy: 'exact' | 'line' | 'anchor',
  ): LocateResult => ({
    ok: true,
    element: entry.opening,
    jsx: entry.element,
    parent: entry.parent,
    path: entry.path,
    matchedBy,
  });

  // 1. 双锚点都存在且指向同一个元素 → 最可信
  if (byAnchor && byLine && byAnchor === byLine) return toResult(byAnchor, 'exact');

  // 2. 双锚点都存在但指向不同元素 → 文件结构变了，行号不再可信
  if (byAnchor && byLine && byAnchor !== byLine) {
    // 结构锚点可能因为用户真的移动了元素而失效；
    // 若行号锚点仍然精确匹配且该行只有一个元素，可以安全采用。
    if (sameLine.length === 1) return toResult(byLine, 'exact');
    return {
      ok: false,
      reason: '元素位置已变化（结构锚点与行号不一致），请重新选择该元素',
    };
  }

  // 3. 有结构锚点 → 用它（行号漂移场景）
  if (byAnchor) return toResult(byAnchor, 'anchor');

  // 4. 只有行号
  if (byLine) return toResult(byLine, 'exact');
  if (nearLine) return toResult(nearLine, 'exact');
  if (sameLine.length === 1) return toResult(sameLine[0], 'line');

  if (sameLine.length > 1) {
    return {
      ok: false,
      reason: `第 ${locator.line} 行有 ${sameLine.length} 个 JSX 元素，无法唯一定位`,
    };
  }
  return { ok: false, reason: `第 ${locator.line} 行没有找到 JSX 元素` };
}

/** 结构锚点字符串。 */
export function anchorOf(path: JsxTreeEntry['path']): string {
  return pathToAnchor(path);
}
