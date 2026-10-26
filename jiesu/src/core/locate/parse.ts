import { parse as babelParse } from '@babel/parser';
import type { File, JSXElement, JSXOpeningElement } from '@babel/types';

/** 元素在源码中的位置。字段与 babel 注入的 `__source` 一致（line 1-based，column 0-based）。 */
export interface ElementLocator {
  filePath: string;
  line: number;
  column: number;
}

export interface RecastParser {
  parse: (source: string) => File;
}

/**
 * 统一解析入口：TS + TSX，容错模式。
 * 用 @babel/parser 直接喂给 recast，避免依赖 recast/parsers/typescript 的类型声明。
 */
export const tsxParser: RecastParser = {
  parse(source: string) {
    return babelParse(source, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: ['typescript', 'jsx'],
    });
  },
};

export function parseSource(code: string): File {
  return tsxParser.parse(code);
}

/** 收集文件里所有 JSX 开始标签（自闭合标签也在内）。 */
export function collectJsxElements(ast: File): JSXOpeningElement[] {
  const out: JSXOpeningElement[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; loc?: { start?: { line?: number; column?: number } } };
    if (n.type === 'JSXOpeningElement' && n.loc?.start) {
      out.push(node as JSXOpeningElement);
    }
    for (const key of Object.keys(node as object)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast);
  return out;
}

export type LocateResult =
  | { ok: true; element: JSXOpeningElement; parent: JSXElement | null; matchedBy: 'exact' | 'line' }
  | { ok: false; reason: string };

/** 收集所有 JSX 开始标签，并记录其所属的 JSXElement 父节点（改文本时需要）。 */
function collectJsxWithParent(ast: File): Array<{
  element: JSXOpeningElement;
  parent: JSXElement | null;
}> {
  const out: Array<{ element: JSXOpeningElement; parent: JSXElement | null }> = [];

  const visit = (node: unknown, parent: JSXElement | null): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string };
    if (n.type === 'JSXElement') {
      const jsxEl = node as JSXElement;
      const opening = jsxEl.openingElement;
      if (opening?.loc?.start) out.push({ element: opening, parent: jsxEl });
    }
    for (const key of Object.keys(node as object)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach((c) => visit(c, n.type === 'JSXElement' ? (node as JSXElement) : parent));
      else if (child && typeof child === 'object') {
        visit(child, n.type === 'JSXElement' ? (node as JSXElement) : parent);
      }
    }
  };

  visit(ast, null);
  return out;
}

/**
 * 按位置找到 JSX 元素。
 * 优先精确匹配 line+column；失败时退化为"同一行唯一元素"——真实场景中行级定位已足够，
 * 且比要求列号完全一致更抗编译器差异。
 */
export function findJsxElement(ast: File, locator: ElementLocator): LocateResult {
  const hits = collectJsxWithParent(ast);
  if (hits.length === 0) return { ok: false, reason: '文件中没有 JSX 元素' };

  const startOf = (el: JSXOpeningElement) => el.loc?.start;

  const exact = hits.find(
    (h) => startOf(h.element)?.line === locator.line && startOf(h.element)?.column === locator.column,
  );
  if (exact) return { ok: true, element: exact.element, parent: exact.parent, matchedBy: 'exact' };

  // 容错：列号差 1（不同工具的 0/1-based 差异）
  const near = hits.find(
    (h) =>
      startOf(h.element)?.line === locator.line &&
      Math.abs((startOf(h.element)?.column ?? -99) - locator.column) === 1,
  );
  if (near) return { ok: true, element: near.element, parent: near.parent, matchedBy: 'exact' };

  const sameLine = hits.filter((h) => startOf(h.element)?.line === locator.line);
  if (sameLine.length === 1) {
    return { ok: true, element: sameLine[0].element, parent: sameLine[0].parent, matchedBy: 'line' };
  }

  if (sameLine.length > 1) {
    return {
      ok: false,
      reason: `第 ${locator.line} 行有 ${sameLine.length} 个 JSX 元素，无法唯一定位`,
    };
  }
  return { ok: false, reason: `第 ${locator.line} 行没有找到 JSX 元素` };
}
