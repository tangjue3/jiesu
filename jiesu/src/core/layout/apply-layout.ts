import type { JSXElement } from '@babel/types';

import { anchorOf, findJsxElement, parseSource, type ElementLocator } from '../locate/parse.js';
import { getClassNameTarget } from '../write/classname-target.js';
import { parseClass } from '../write/tailwind-classes.js';
import { pxToSpacingScale } from '../write/units.js';
import { auditLayoutSafety } from './guard.js';
import { checkRequirements, inferLayoutContext, type LayoutContext } from './model.js';
import { reorderJsxChildren } from './reorder.js';
import { FAMILIES, type Family } from './tw-layout.js';
import { computeDiff, type FileDiff } from '../write/apply.js';

export type LayoutOp =
  | { kind: 'flexDirection'; to: string; variant?: string }
  | { kind: 'alignItems'; to: string; variant?: string }
  | { kind: 'justifyContent'; to: string; variant?: string }
  | { kind: 'gap'; toPx: number; axis?: 'x' | 'y' | null; variant?: string }
  | { kind: 'order'; to: number; variant?: string }
  | {
      kind: 'gridColumn';
      to: { span?: number; start?: number; end?: number };
      variant?: string;
    }
  | {
      kind: 'gridRow';
      to: { span?: number; start?: number; end?: number };
      variant?: string;
    }
  | { kind: 'gridCols'; to: number; variant?: string }
  | { kind: 'gridRows'; to: number; variant?: string }
  | { kind: 'childOrder'; to: number[] };

export interface LayoutResult {
  status: 'ok' | 'unresolved' | 'not-found';
  reason?: string;
  code?: string;
  changed: boolean;
  /** 受影响的族 */
  family?: string;
  /** 命中的 class token 数 */
  matched?: number;
  /** 与原文件的行级差异 */
  diff?: FileDiff;
  /** 写回后元素的新结构锚点 */
  anchor?: string;
}

/* ------------------------------------------------------------------ *
 * 族操作
 * ------------------------------------------------------------------ */

interface FamilyRequest {
  family: Family;
  /** 目标 class（不含变体前缀） */
  target: string;
  /** 目标变体前缀，如 'md:' */
  variant?: string;
}

function resolveFamilyRequest(op: LayoutOp): FamilyRequest | { error: string } {
  switch (op.kind) {
    case 'flexDirection':
      return { family: FAMILIES.flexDirection, target: op.to, variant: op.variant };
    case 'alignItems':
      return { family: FAMILIES.alignItems, target: op.to, variant: op.variant };
    case 'justifyContent':
      return { family: FAMILIES.justifyContent, target: op.to, variant: op.variant };
    case 'gap': {
      const scale = pxToSpacingScale(op.toPx);
      if (scale === null) {
        return { error: `${op.toPx}px 无法映射到 Tailwind gap 刻度（需要 2px 粒度）` };
      }
      const target = op.axis ? `gap-${op.axis}-${scale}` : `gap-${scale}`;
      return { family: FAMILIES.gap, target, variant: op.variant };
    }
    case 'order':
      return { family: FAMILIES.order, target: `order-${op.to}`, variant: op.variant };
    case 'gridColumn': {
      if (op.to.span !== undefined) {
        return { family: FAMILIES.gridColumnSpan, target: `col-span-${op.to.span}`, variant: op.variant };
      }
      if (op.to.start !== undefined) {
        return { family: FAMILIES.gridColumnStart, target: `col-start-${op.to.start}`, variant: op.variant };
      }
      if (op.to.end !== undefined) {
        return { family: FAMILIES.gridColumnEnd, target: `col-end-${op.to.end}`, variant: op.variant };
      }
      return { error: 'gridColumn 需要指定 span / start / end' };
    }
    case 'gridRow': {
      if (op.to.span !== undefined) {
        return { family: FAMILIES.gridRowSpan, target: `row-span-${op.to.span}`, variant: op.variant };
      }
      if (op.to.start !== undefined) {
        return { family: FAMILIES.gridRowStart, target: `row-start-${op.to.start}`, variant: op.variant };
      }
      if (op.to.end !== undefined) {
        return { family: FAMILIES.gridRowEnd, target: `row-end-${op.to.end}`, variant: op.variant };
      }
      return { error: 'gridRow 需要指定 span / start / end' };
    }
    case 'gridCols':
      return { family: FAMILIES.gridCols, target: `grid-cols-${op.to}`, variant: op.variant };
    case 'gridRows':
      return { family: FAMILIES.gridRows, target: `grid-rows-${op.to}`, variant: op.variant };
    default:
      return { error: '该操作不是族操作' };
  }
}

/** 删除一个 token：连带吃掉相邻的一个空格，避免留下双空格；换行始终保留。 */
function removeToken(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  if (s > 0 && text[s - 1] === ' ') s -= 1;
  if (e < text.length && text[e] === ' ') e += 1;
  return text.slice(0, s) + text.slice(e);
}

/**
 * 在 class 文本中替换某个族的类。
 *
 * 只动该族的 token；空白与其它 token 逐字节保留。
 * 同族有多个 token 时只保留第一个（其余删除），避免出现互相覆盖的重复类。
 */
export function replaceFamilyInText(
  text: string,
  family: Family,
  targetBase: string,
  variantPrefix?: string,
): { text: string; matched: number; created: boolean } {
  const re = /\S+/g;
  const matches: Array<{ start: number; end: number; token: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    const parsed = parseClass(token);
    if (!family.matches(parsed.base)) continue;
    // 变体必须一致：op 指定了 variant 就只动同 variant 的类
    if (variantPrefix !== undefined && parsed.variants !== variantPrefix) continue;
    if (variantPrefix === undefined && parsed.variants !== '') continue;
    matches.push({ start: m.index, end: m.index + token.length, token });
  }

  const newToken = `${variantPrefix ?? ''}${targetBase}`;

  if (matches.length === 0) {
    if (!family.allowCreate) {
      return { text, matched: 0, created: false };
    }
    const separator = text.length === 0 || /\s$/.test(text) ? '' : ' ';
    return { text: `${text}${separator}${newToken}`, matched: 0, created: true };
  }

  // 1) 先从后往前删掉多余的同族 token（位置不受影响）
  let out = text;
  for (let i = matches.length - 1; i >= 1; i -= 1) {
    const dup = matches[i];
    out = removeToken(out, dup.start, dup.end);
  }

  // 2) 再替换第一个匹配
  const first = matches[0];
  const firstParsed = parseClass(first.token);
  // `flex` 与 `flex-row` 语义等价：目标是 row 时保持 `flex` 不动，避免无意义 diff
  const replacement =
    targetBase === 'flex-row' && firstParsed.base === 'flex' ? first.token : newToken;
  out = out.slice(0, first.start) + replacement + out.slice(first.end);

  return { text: out, matched: matches.length, created: false };
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export function applyLayoutOp(
  code: string,
  locator: ElementLocator,
  op: LayoutOp,
  parentContext?: LayoutContext,
): LayoutResult {
  const ast = parseSource(code);
  const located = findJsxElement(ast, locator);
  if (!located.ok) {
    return { status: 'not-found', reason: located.reason, changed: false };
  }
  const el = located.element;
  const anchor = anchorOf(located.path);

  /* ---------- 子项重排（结构级操作） ---------- */
  if (op.kind === 'childOrder') {
    // 重排的是**选中元素自己**的子项
    const container: JSXElement = located.jsx;
    const req = checkRequirements(
      { display: 'other', isFlexContainer: false, isGridContainer: false, hasLayoutClasses: false },
      { parent: 'flex' },
      parentContext,
    );
    if (!req.ok) {
      return { status: 'unresolved', reason: req.reason, changed: false };
    }

    const result = reorderJsxChildren(code, container, op.to);
    if (!result.ok) {
      return { status: 'unresolved', reason: result.reason, changed: false };
    }
    if (!result.edit) {
      return { status: 'ok', changed: false, family: 'childOrder' };
    }
    const updated = code.slice(0, result.edit.start) + result.edit.after + code.slice(result.edit.end);
    const safety = auditLayoutSafety(updated);
    if (!safety.ok) {
      return {
        status: 'unresolved',
        reason: `重排结果包含被禁止的布局写法：${safety.violations.join('、')}`,
        changed: false,
      };
    }
    return {
      status: 'ok',
      changed: true,
      code: updated,
      family: 'childOrder',
      matched: result.itemCount,
      diff: computeDiff(code, updated),
      anchor,
    };
  }

  /* ---------- 族操作 ---------- */
  const request = resolveFamilyRequest(op);
  if ('error' in request) {
    return { status: 'unresolved', reason: request.error, changed: false };
  }

  const target = getClassNameTarget(el);
  if (target.form === 'unresolved') {
    return { status: 'unresolved', reason: target.reason, changed: false };
  }

  // 取静态 class 文本用于上下文推断
  const staticText =
    target.form === 'string'
      ? target.node.value
      : target.node.quasis.map((q) => q.value.raw).join(' ');
  const tokens = staticText.split(/\s+/).filter(Boolean);
  const ctx = inferLayoutContext(tokens);

  const containerReq =
    op.kind === 'flexDirection' || op.kind === 'alignItems' || op.kind === 'justifyContent'
      ? { container: 'flex' as const }
      : op.kind === 'gap'
        ? {}
        : op.kind === 'gridColumn' || op.kind === 'gridRow'
          ? { parent: 'grid' as const }
          : op.kind === 'gridCols' || op.kind === 'gridRows'
            ? { container: 'grid' as const }
            : op.kind === 'order'
              ? { parent: 'flex' as const }
              : {};

  const req = checkRequirements(ctx, containerReq, parentContext);
  if (!req.ok) {
    return { status: 'unresolved', reason: req.reason, changed: false };
  }

  // 执行替换
  let updated: string;
  let matched = 0;
  let created = false;

  if (target.form === 'string') {
    const result = replaceFamilyInText(
      target.node.value,
      request.family,
      request.target,
      request.variant,
    );
    matched = result.matched;
    created = result.created;
    if (matched === 0 && !created) {
      return {
        status: 'unresolved',
        reason: `该容器当前没有设置${request.family.name}，已拒绝擅自新增`,
        changed: false,
      };
    }
    const raw = code.slice(target.node.start as number, target.node.end as number);
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : '"';
    const start = target.node.start as number;
    const end = target.node.end as number;
    updated = code.slice(0, start) + quote + result.text + quote + code.slice(end);
  } else {
    // 模板字面量：逐段替换
    const pieces: string[] = [];
    let cursor = target.node.start as number;
    for (const quasi of target.node.quasis) {
      const qStart = quasi.start as number;
      const qEnd = quasi.end as number;
      if (typeof qStart !== 'number' || typeof qEnd !== 'number') continue;
      pieces.push(code.slice(cursor, qStart));
      const result = replaceFamilyInText(
        code.slice(qStart, qEnd),
        request.family,
        request.target,
        request.variant,
      );
      matched += result.matched;
      created = created || result.created;
      pieces.push(result.text);
      cursor = qEnd;
    }
    pieces.push(code.slice(cursor));
    const candidate = pieces.join('');
    if (matched === 0 && !created) {
      return {
        status: 'unresolved',
        reason: `该容器当前没有设置${request.family.name}，已拒绝擅自新增`,
        changed: false,
      };
    }
    updated = candidate;
  }

  if (updated === code) {
    return { status: 'ok', changed: false, family: request.family.name, matched, anchor };
  }

  // 安全闸：绝不允许产出绝对定位
  const safety = auditLayoutSafety(updated);
  if (!safety.ok) {
    return {
      status: 'unresolved',
      reason: `布局改写结果包含被禁止的写法：${safety.violations.join('、')}`,
      changed: false,
    };
  }

  return {
    status: 'ok',
    changed: true,
    code: updated,
    family: request.family.name,
    matched,
    diff: computeDiff(code, updated),
    anchor,
  };
}
