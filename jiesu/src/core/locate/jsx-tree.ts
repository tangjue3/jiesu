import { parse } from '@babel/parser';
import type { JSXAttribute, JSXElement, JSXOpeningElement } from '@babel/types';

/**
 * JSX 树的唯一遍历实现。
 *
 * 为什么必须统一：编译期注入的 `data-jiesu-id` 与服务端定位用的路径，
 * 必须由**同一份算法**产出，否则 id 与定位对不上，整个锚点校验形同虚设。
 *
 * 路径（path）是什么：元素在 JSX 层级中的索引链，如 [0, 1]。
 * 它只依赖元素之间的相对结构，**不依赖行号**——行号会漂移，结构不会。
 */

export type PathSegment = number | string;

export interface JsxTreeEntry {
  element: JSXElement;
  opening: JSXOpeningElement;
  /** 最近的 JSX 祖先（改文本时需要它的 children） */
  parent: JSXElement | null;
  path: PathSegment[];
  line: number;
  column: number;
}

/**
 * 路径的语义化字符串形式，用作"结构锚点"。
 * 例：[0, 1] → "0.1"
 */
export function pathToAnchor(path: PathSegment[]): string {
  return path.join('.');
}

export function parseJsx(code: string): ReturnType<typeof parse> {
  return parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['typescript', 'jsx'],
  });
}

/**
 * 路径作用域：
 *  - top     文件顶层（不在任何 JSX 元素内）
 *  - children 某个 JSX 元素的直接子元素
 *  - attr    某个 JSX 元素的属性值里的 JSX
 *  - expr    某个 JSX 元素的子表达式里的 JSX
 */
type Scope =
  | { kind: 'top' }
  | { kind: 'children'; path: PathSegment[]; counter: number }
  | { kind: 'attr'; path: PathSegment[]; attrName: string; counter: number }
  | { kind: 'expr'; path: PathSegment[]; counter: number };

const SKIP_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

/**
 * 收集文件里所有 JSX 元素，附带稳定路径。
 *
 * 路径规则：
 *  - 直接子元素：父路径 + [同层序号]
 *  - 属性里的 JSX：父路径 + ["@属性名", 同属性内序号]
 *  - 表达式里的 JSX：父路径 + ["~", 同层序号]
 *  - 文件顶层的 JSX：顶层序号
 *
 * 保证：**同一文件内所有元素的路径互不相同**，因此锚点可用于唯一定位。
 */
export function collectJsxTree(code: string): JsxTreeEntry[] {
  const ast = parseJsx(code);
  const entries: JsxTreeEntry[] = [];
  let topCounter = 0;

  const pathFor = (scope: Scope): PathSegment[] => {
    switch (scope.kind) {
      case 'top':
        return [topCounter++];
      case 'children':
        return [...scope.path, scope.counter++];
      case 'attr':
        return [...scope.path, `@${scope.attrName}`, scope.counter++];
      case 'expr':
        return [...scope.path, '~', scope.counter++];
    }
  };

  const handleJsx = (
    element: JSXElement,
    scope: Scope,
    parent: JSXElement | null,
  ): void => {
    const path = pathFor(scope);
    const opening = element.openingElement;
    const start = opening.loc?.start;

    entries.push({
      element,
      opening,
      parent,
      path,
      line: start?.line ?? 0,
      column: start?.column ?? 0,
    });

    // 直接子元素
    walkChildren(element.children, { kind: 'children', path, counter: 0 }, element);

    // 属性值里的 JSX
    for (const attr of opening.attributes) {
      if (attr.type !== 'JSXAttribute') continue;
      if (!attr.value) continue;
      walkGeneric(
        attr.value,
        { kind: 'attr', path, attrName: attrName(attr), counter: 0 },
        element,
      );
    }
  };

  const handleFragment = (
    fragment: { children: unknown[]; loc?: { start?: { line?: number; column?: number } } },
    scope: Scope,
    parent: JSXElement | null,
  ): void => {
    const path = pathFor(scope);
    walkChildren(fragment.children, { kind: 'children', path, counter: 0 }, parent);
  };

  const walkChildren = (
    children: unknown[],
    scope: Scope,
    parent: JSXElement | null,
  ): void => {
    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      const type = (child as { type?: string }).type;
      if (type === 'JSXElement') {
        handleJsx(child as JSXElement, scope, parent);
      } else if (type === 'JSXFragment') {
        handleFragment(child as never, scope, parent);
      } else if (type === 'JSXExpressionContainer') {
        const expression = (child as { expression?: unknown }).expression;
        walkGeneric(expression, { kind: 'expr', path: scopePath(scope), counter: 0 }, parent);
      } else {
        walkGeneric(child, scope, parent);
      }
    }
  };

  const walkGeneric = (
    node: unknown,
    scope: Scope,
    parent: JSXElement | null,
  ): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walkGeneric(item, scope, parent);
      return;
    }
    const typed = node as { type?: string };
    if (typed.type === 'JSXElement') {
      handleJsx(node as JSXElement, scope, parent);
      return;
    }
    if (typed.type === 'JSXFragment') {
      handleFragment(node as never, scope, parent);
      return;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      walkGeneric((node as Record<string, unknown>)[key], scope, parent);
    }
  };

  // 文件顶层
  const program = (ast as { program?: { body?: unknown[] } }).program;
  if (program?.body) {
    for (const statement of program.body) {
      walkGeneric(statement, { kind: 'top' }, null);
    }
  }

  return entries;
}

function scopePath(scope: Scope): PathSegment[] {
  switch (scope.kind) {
    case 'top':
      return [];
    case 'children':
    case 'attr':
    case 'expr':
      return scope.path;
  }
}

function attrName(attr: JSXAttribute): string {
  const name = attr.name;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`;
  return 'prop';
}
