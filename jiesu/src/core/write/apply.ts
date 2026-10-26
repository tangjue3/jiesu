import type {
  JSXAttribute,
  JSXElement,
  JSXExpressionContainer,
  JSXOpeningElement,
  ObjectExpression,
  ObjectProperty,
  StringLiteral,
  TemplateLiteral,
} from '@babel/types';

import { anchorOf, findJsxElement, parseSource, type ElementLocator } from '../locate/parse.js';
import { parseClass, type StyleCategory } from './tailwind-classes.js';
import { setTranslate } from './translate.js';
import { pxToTailwindClass } from './units.js';

export type StyleOp =
  | { kind: 'class'; category: StyleCategory; fromBase: string; toBase: string }
  | {
      kind: 'classByPx';
      category: 'spacing' | 'radius';
      /** 类族前缀：p / px / gap / rounded ……决定只改这一族，不误伤同类别其它族 */
      prefix: string;
      fromPx: number;
      toPx: number;
    }
  | { kind: 'text'; to: string }
  | { kind: 'inlineStyle'; prop: string; to: string | number }
  /**
   * 拖拽位移：元素"跟着鼠标走"的落地方式。
   * 产出 `translate-x-N` / `translate-y-N`，**绝不产出定位坐标**。
   */
  | { kind: 'translate'; xPx: number; yPx: number };

/** 一次精确到字符区间的源码修改。 */
export interface SourceEdit {
  start: number;
  end: number;
  before: string;
  after: string;
}

export interface FileDiff {
  startLine: number;
  endLine: number;
  before: string;
  after: string;
}

export interface ApplyResult {
  status: 'ok' | 'unresolved' | 'not-found';
  reason?: string;
  code?: string;
  diff?: FileDiff;
  edits: SourceEdit[];
  changed: boolean;
  /** 命中的 class token 数量 */
  matched?: number;
  /** 写回后元素的新结构锚点（行号可能已漂移，客户端据此重新选中） */
  anchor?: string;
}

/* ------------------------------------------------------------------ *
 * className 取值形态
 * ------------------------------------------------------------------ */

type ClassNameTarget =
  | { form: 'string'; node: StringLiteral }
  | { form: 'template'; node: TemplateLiteral }
  | { form: 'unresolved'; reason: string };

function getAttribute(el: JSXOpeningElement, name: string): JSXAttribute | null {
  for (const attr of el.attributes) {
    if (attr.type !== 'JSXAttribute') continue;
    const attrName = attr.name;
    if (attrName.type === 'JSXIdentifier' && attrName.name === name) return attr;
  }
  return null;
}

function calleeName(expr: unknown): string {
  const e = expr as { type?: string; name?: string; property?: { name?: string } };
  if (e?.type === 'Identifier') return e.name ?? 'unknown';
  if (e?.type === 'MemberExpression') return e.property?.name ?? 'member expression';
  return 'unknown';
}

function getClassNameTarget(el: JSXOpeningElement): ClassNameTarget {
  const attr = getAttribute(el, 'className') ?? getAttribute(el, 'class');
  if (!attr) return { form: 'unresolved', reason: '元素没有 className 属性' };

  const value = attr.value;
  if (!value) return { form: 'unresolved', reason: 'className 没有值' };

  if (value.type === 'StringLiteral') return { form: 'string', node: value };

  if (value.type === 'JSXExpressionContainer') {
    const expr = (value as JSXExpressionContainer).expression;
    if (expr.type === 'StringLiteral') return { form: 'string', node: expr };
    if (expr.type === 'TemplateLiteral') return { form: 'template', node: expr };
    if (expr.type === 'CallExpression') {
      return {
        form: 'unresolved',
        reason: `className 由函数调用 ${calleeName(expr.callee)}() 生成，无法确定唯一静态值`,
      };
    }
    if (expr.type === 'ConditionalExpression') {
      return { form: 'unresolved', reason: 'className 由条件表达式生成，无法确定唯一目标' };
    }
    if (expr.type === 'LogicalExpression') {
      return { form: 'unresolved', reason: 'className 由逻辑表达式生成，无法确定唯一目标' };
    }
    if (expr.type === 'Identifier' || expr.type === 'MemberExpression') {
      return { form: 'unresolved', reason: 'className 来自变量或对象属性，无法确定静态值' };
    }
    return { form: 'unresolved', reason: `暂不支持的 className 形态：${expr.type}` };
  }

  return { form: 'unresolved', reason: `暂不支持的 className 形态：${value.type}` };
}

/* ------------------------------------------------------------------ *
 * token 级替换（保留所有空白与其它字符）
 * ------------------------------------------------------------------ */

export function replaceTokensInText(
  text: string,
  category: StyleCategory,
  fromBase: string,
  toBase: string,
): { text: string; count: number } {
  const re = /\S+/g;
  let out = '';
  let last = 0;
  let count = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    const parsed = parseClass(token);
    if (parsed.category === category && parsed.base === fromBase) {
      out += text.slice(last, m.index);
      out += `${parsed.variants}${toBase}`;
      last = m.index + token.length;
      count += 1;
    }
  }
  out += text.slice(last);
  return { text: out, count };
}

/* ------------------------------------------------------------------ *
 * 引号处理
 * ------------------------------------------------------------------ */

function splitQuotes(raw: string): { quote: string; inner: string } {
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0]) {
    return { quote: raw[0], inner: raw.slice(1, -1) };
  }
  return { quote: '', inner: raw };
}

/* ------------------------------------------------------------------ *
 * diff
 * ------------------------------------------------------------------ */

export function computeDiff(original: string, updated: string): FileDiff {
  const a = original.split('\n');
  const b = updated.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  return {
    startLine: start + 1,
    endLine: endA + 1,
    before: a.slice(start, endA + 1).join('\n'),
    after: b.slice(start, endB + 1).join('\n'),
  };
}

/** 按字符区间应用一组修改。插入用 start === end 表示。 */
export function applyEdits(code: string, edits: SourceEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.after + out.slice(edit.end);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export function applyOp(code: string, locator: ElementLocator, op: StyleOp): ApplyResult {
  const tree = parseSource(code);
  const located = findJsxElement(tree, locator);
  if (!located.ok) {
    return { status: 'not-found', reason: located.reason, edits: [], changed: false };
  }

  const el = located.element;
  const edits: SourceEdit[] = [];
  const anchor = anchorOf(located.path);

  if (op.kind === 'translate') {
    const target = getClassNameTarget(el);
    if (target.form === 'unresolved') {
      return { status: 'unresolved', reason: target.reason, edits: [], changed: false };
    }
    if (target.form !== 'string') {
      return {
        status: 'unresolved',
        reason: 'className 是模板拼接，位移改写暂不支持（改不了就明说，不猜）',
        edits: [],
        changed: false,
      };
    }

    const node = target.node;
    const raw = code.slice(node.start as number, node.end as number);
    const { quote, inner } = splitQuotes(raw);
    const result = setTranslate(inner, op.xPx, op.yPx);
    if (!result.ok) {
      return { status: 'unresolved', reason: result.reason ?? '无法生成位移类', edits: [], changed: false };
    }
    if (!result.changed) {
      return finish(code, [], 0, anchor);
    }
    edits.push({
      start: node.start as number,
      end: node.end as number,
      before: raw,
      after: `${quote}${result.text}${quote}`,
    });
    return finish(code, edits, 1, anchor);
  }

  if (op.kind === 'class' || op.kind === 'classByPx') {
    const category: StyleCategory = op.category;
    let fromBase: string;
    let toBase: string;

    if (op.kind === 'class') {
      fromBase = op.fromBase;
      toBase = op.toBase;
    } else {
      const fromClass = pxToTailwindClass(op.category, op.prefix, op.fromPx);
      const toClass = pxToTailwindClass(op.category, op.prefix, op.toPx);
      if (!fromClass) {
        return {
          status: 'unresolved',
          reason: `当前值 ${op.fromPx}px 无法映射到 Tailwind ${op.category} 类（需要离散刻度）`,
          edits: [],
          changed: false,
        };
      }
      if (!toClass) {
        return {
          status: 'unresolved',
          reason: `${op.toPx}px 无法映射到 Tailwind ${op.category} 类（需要离散刻度）`,
          edits: [],
          changed: false,
        };
      }
      fromBase = fromClass;
      toBase = toClass;
    }

    const target = getClassNameTarget(el);
    if (target.form === 'unresolved') {
      return { status: 'unresolved', reason: target.reason, edits: [], changed: false };
    }

    let matched = 0;

    if (target.form === 'string') {
      const node = target.node;
      const raw = code.slice(node.start as number, node.end as number);
      const { quote, inner } = splitQuotes(raw);
      const result = replaceTokensInText(inner, category, fromBase, toBase);
      matched = result.count;
      if (matched > 0) {
        edits.push({
          start: node.start as number,
          end: node.end as number,
          before: raw,
          after: `${quote}${result.text}${quote}`,
        });
      }
    } else {
      for (const quasi of target.node.quasis) {
        const start = quasi.start as number;
        const end = quasi.end as number;
        if (typeof start !== 'number' || typeof end !== 'number') continue;
        const raw = code.slice(start, end);
        const result = replaceTokensInText(raw, category, fromBase, toBase);
        if (result.count > 0) {
          matched += result.count;
          edits.push({ start, end, before: raw, after: result.text });
        }
      }
    }

    if (matched === 0) {
      return {
        status: 'unresolved',
        reason: `没有找到 ${category}${fromBase ? ` 类 ${fromBase}` : ' 类'}，可改目标不存在`,
        edits: [],
        changed: false,
      };
    }
    return finish(code, edits, matched, anchor);
  }

  if (op.kind === 'text') {
    // 元素**自身**的文本在它自己的 children 里（不是父元素的）
    const textNode = located.jsx.children.find(
      (child) => child.type === 'JSXText' && child.value.trim().length > 0,
    );
    if (!textNode || textNode.type !== 'JSXText') {
      return {
        status: 'unresolved',
        reason: '该元素的文本是动态表达式，无法直接改写',
        edits: [],
        changed: false,
      };
    }
    edits.push({
      start: textNode.start as number,
      end: textNode.end as number,
      before: code.slice(textNode.start as number, textNode.end as number),
      after: op.to,
    });
    return finish(code, edits, 1, anchor);
  }

  // inlineStyle
  const styleAttr = getAttribute(el, 'style');
  if (!styleAttr || styleAttr.value?.type !== 'JSXExpressionContainer') {
    return { status: 'unresolved', reason: '元素没有 style 对象属性', edits: [], changed: false };
  }
  const expr = (styleAttr.value as JSXExpressionContainer).expression;
  if (expr.type !== 'ObjectExpression') {
    return {
      status: 'unresolved',
      reason: 'style 不是对象字面量，无法确定性改写',
      edits: [],
      changed: false,
    };
  }
  const obj = expr as ObjectExpression;
  const prop = obj.properties.find(
    (p): p is ObjectProperty =>
      p.type === 'ObjectProperty' &&
      ((p.key.type === 'Identifier' && p.key.name === op.prop) ||
        (p.key.type === 'StringLiteral' && p.key.value === op.prop)),
  );
  if (!prop) {
    return { status: 'unresolved', reason: `style 中没有 ${op.prop} 属性`, edits: [], changed: false };
  }

  const valueNode = prop.value;
  const start = valueNode.start as number;
  const end = valueNode.end as number;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return { status: 'unresolved', reason: 'style 值没有位置信息', edits: [], changed: false };
  }
  const raw = code.slice(start, end);

  if (valueNode.type === 'StringLiteral') {
    const { quote, inner } = splitQuotes(raw);
    edits.push({ start, end, before: raw, after: `${quote}${String(op.to)}${quote}` });
  } else if (valueNode.type === 'NumericLiteral') {
    edits.push({ start, end, before: raw, after: String(op.to) });
  } else {
    return {
      status: 'unresolved',
      reason: `style.${op.prop} 的值不是字面量，无法确定性改写`,
      edits: [],
      changed: false,
    };
  }
  return finish(code, edits, 1, anchor);
}

function finish(
  original: string,
  edits: SourceEdit[],
  matched: number,
  anchor?: string,
): ApplyResult {
  const updated = applyEdits(original, edits);
  if (updated === original) {
    return { status: 'ok', changed: false, code: original, edits, matched, anchor };
  }
  return {
    status: 'ok',
    changed: true,
    code: updated,
    diff: computeDiff(original, updated),
    edits,
    matched,
    anchor,
  };
}
