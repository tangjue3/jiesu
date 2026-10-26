/**
 * 测试用 JSX 定位工具（靶场 fixture 专用，不进产品内核）。
 *
 * 真实运行时是靠编译期注入的 `data-jiesu-src` 拿到 `file:line:column`；
 * 这里是它的替身：直接解析 fixture 源码，按 class token / 文本 / 行号反推出同样的定位，
 * 从而让 S2/S4 这些纯 Node 用例不需要起浏览器。
 */

import { parse } from '@babel/parser';
import type { JSXAttribute, JSXElement, JSXOpeningElement, TemplateElement } from '@babel/types';

import type { ElementLocator } from '../../src/core/locate/parse';

/** fixture 里并没有真实文件名，统一用占位名。 */
const FIXTURE_FILE = 'fixture.tsx';

export interface ElementHit {
  el: JSXOpeningElement;
  parent: JSXElement | null;
}

/** 遍历所有 JSX 元素，并记录父 JSXElement。 */
export function collectJsx(code: string): ElementHit[] {
  const ast = parse(code, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx'],
  });
  const out: ElementHit[] = [];

  const visit = (node: unknown, parent: JSXElement | null): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string };
    let nextParent = parent;
    if (n.type === 'JSXElement') {
      const jsxEl = node as JSXElement;
      nextParent = jsxEl;
      if (jsxEl.openingElement?.loc?.start) {
        out.push({ el: jsxEl.openingElement, parent: jsxEl });
      }
    }
    for (const key of Object.keys(node as object)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach((c) => visit(c, nextParent));
      else if (child && typeof child === 'object') visit(child, nextParent);
    }
  };

  visit(ast, null);
  return out;
}

/** 取元素的静态 class 文本（字符串或模板字面量）；动态形态返回 null。 */
export function staticClassText(el: JSXOpeningElement): string | null {
  const attr = el.attributes.find(
    (a): a is JSXAttribute =>
      a.type === 'JSXAttribute' &&
      a.name.type === 'JSXIdentifier' &&
      (a.name.name === 'className' || a.name.name === 'class'),
  );
  if (!attr) return null;
  const value = attr.value;
  if (!value) return null;
  if (value.type === 'StringLiteral') return value.value;
  if (value.type === 'JSXExpressionContainer') {
    const expr = value.expression;
    if (expr.type === 'StringLiteral') return expr.value;
    if (expr.type === 'TemplateLiteral') {
      return expr.quasis.map((q: TemplateElement) => q.value.raw).join(' ');
    }
  }
  return null;
}

function toLocator(el: JSXOpeningElement): ElementLocator {
  return {
    filePath: FIXTURE_FILE,
    line: el.loc!.start.line,
    column: el.loc!.start.column,
  };
}

/**
 * 按 class token 精确定位元素（token 必须完全相等，避免 p-4 命中 px-4）。
 * 这模拟真实运行时 L1 注入 registry 给出的 file:line:column。
 */
export function locateByClassToken(code: string, token: string, occurrence = 0): ElementLocator {
  const hits = collectJsx(code).filter((h) =>
    (staticClassText(h.el) ?? '').split(/\s+/).includes(token),
  );
  if (hits.length <= occurrence) {
    throw new Error(`fixture 中找不到第 ${occurrence} 个 class token: ${token}`);
  }
  return toLocator(hits[occurrence].el);
}

/** 按文本内容定位元素。 */
export function locateByText(code: string, text: string): ElementLocator {
  for (const hit of collectJsx(code)) {
    if (!hit.parent) continue;
    const hasText = hit.parent.children.some(
      (c) => c.type === 'JSXText' && c.value.includes(text),
    );
    if (hasText) return toLocator(hit.el);
  }
  throw new Error(`fixture 中找不到文本: ${text}`);
}

/**
 * 按行号定位（用于 className 为动态形态的 fixture）。
 * 真实运行时 L1 注入的 registry 记录的就是 file:line:column，与 className 是否静态无关。
 */
export function locateByLine(code: string, line: number): ElementLocator {
  const hits = collectJsx(code).filter((h) => h.el.loc!.start.line === line);
  if (hits.length === 0) throw new Error(`fixture 中第 ${line} 行没有 JSX 元素`);
  if (hits.length > 1) throw new Error(`fixture 中第 ${line} 行有多个 JSX 元素`);
  return toLocator(hits[0].el);
}

/** 按 style 属性名定位元素。 */
export function locateByStyleProp(code: string, prop: string): ElementLocator {
  for (const hit of collectJsx(code)) {
    const attr = hit.el.attributes.find(
      (a): a is JSXAttribute =>
        a.type === 'JSXAttribute' &&
        a.name.type === 'JSXIdentifier' &&
        a.name.name === 'style',
    );
    if (!attr || attr.value?.type !== 'JSXExpressionContainer') continue;
    const expr = attr.value.expression;
    if (expr.type !== 'ObjectExpression') continue;
    const found = expr.properties.some(
      (p) =>
        p.type === 'ObjectProperty' &&
        ((p.key.type === 'Identifier' && p.key.name === prop) ||
          (p.key.type === 'StringLiteral' && p.key.value === prop)),
    );
    if (found) return toLocator(hit.el);
  }
  throw new Error(`fixture 中找不到 style.${prop}`);
}
