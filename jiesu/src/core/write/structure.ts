/**
 * 结构化编辑：插入 / 删除 / 复制 JSX 节点。
 *
 * 这是"自由画布"路线的前置能力——从组件库拖一个按钮进画布，落地动作就是
 * "往 App.tsx 里插一段真实 JSX"。所以它必须和改属性用同一套纪律：
 *
 *  1. **AST 只定位，splice 才落地**：绝不整体重印，保证 diff 只含真正新增的几行。
 *  2. **缩进跟着邻居走**：从目标元素/容器的实际缩进推导，不硬编码 2 空格。
 *  3. **改不了就明说**：元素与同级内容挤在同一行、片段不是单根 JSX → 拒绝，不猜。
 *  4. **必须回传新锚点**：新节点插入前不存在，客户端只能靠服务端给的锚点找到它。
 */

import type { JSXElement } from '@babel/types';

import { anchorOf, findJsxElement, parseSource, type ElementLocator } from '../locate/parse.js';
import { parseJsx } from '../locate/jsx-tree.js';
import { applyEdits, computeDiff, type FileDiff, type SourceEdit } from './apply.js';

export type StructureOp =
  | {
      kind: 'insert';
      /** 插到选中元素的**同级**前面或后面 */
      position: 'before' | 'after';
      /** 单根 JSX 片段，可多行；缩进会被重算 */
      snippet: string;
    }
  | {
      kind: 'insertChild';
      /** 插到选中元素**内部**的第一个/最后一个位置 */
      position: 'first' | 'last';
      snippet: string;
    }
  | { kind: 'delete' }
  /** 复制选中元素并插到它后面（画布的 Cmd+D） */
  | { kind: 'duplicate' };

export interface StructureResult {
  status: 'ok' | 'unresolved' | 'not-found';
  reason?: string;
  code?: string;
  diff?: FileDiff;
  /** 实际执行的字符区间修改（撤销依赖它，不能用"邻近行"启发式代替） */
  edits: SourceEdit[];
  changed: boolean;
  /** 插入后新元素的结构锚点——客户端据此选中它 */
  newAnchor?: string;
  /** 插入后新元素的行列（HMR 后用于二次定位） */
  newLine?: number;
  newColumn?: number;
  /** 删除后建议选中的锚点（父元素） */
  nextAnchor?: string;
}

/* ------------------------------------------------------------------ *
 * 片段与缩进
 * ------------------------------------------------------------------ */

/** 片段必须是**单根** JSX 元素——多根无法确定插入边界，直接拒绝。 */
function validateSnippet(snippet: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = snippet.trim();
  if (trimmed.length === 0) return { ok: false, reason: '要插入的内容是空的' };

  type Stmt = { type?: string; expression?: { type?: string; children?: unknown[] } };
  const parseBody = (text: string): Stmt[] | null => {
    try {
      const ast = parseJsx(text) as unknown as { program?: { body?: Stmt[] } };
      return ast.program?.body ?? [];
    } catch {
      return null;
    }
  };

  const isJsxExpr = (stmt: Stmt | undefined): boolean =>
    stmt?.type === 'ExpressionStatement' &&
    (stmt.expression?.type === 'JSXElement' || stmt.expression?.type === 'JSXFragment');

  const body = parseBody(trimmed);
  if (body) {
    if (body.length === 1 && isJsxExpr(body[0])) return { ok: true };
    if (body.length > 1) {
      return { ok: false, reason: '要插入的内容必须是单个元素，不能是多个并列根节点' };
    }
    return { ok: false, reason: '要插入的内容不是一个 JSX 元素' };
  }

  // 直接解析失败但可能是"多个并列根节点"——包一层 fragment 再看，给出更准确的原因
  const wrapped = parseBody(`<>${trimmed}</>`);
  if (wrapped && wrapped.length === 1 && wrapped[0].expression?.type === 'JSXFragment') {
    const children = (wrapped[0].expression.children ?? []).filter(
      (child) => (child as { type?: string }).type !== 'JSXText',
    );
    if (children.length > 1) {
      return {
        ok: false,
        reason: `要插入的内容是 ${children.length} 个并列根节点，必须是单个元素（或自己包一层容器）`,
      };
    }
  }
  return { ok: false, reason: '要插入的内容无法解析为 JSX' };
}

/**
 * 去掉片段的公共缩进与首尾空行，得到"零缩进"的形态。
 * 之后按目标位置的缩进重新加前缀，从而适配任意缩进风格（2 空格 / 4 空格 / Tab）。
 */
function normalizeSnippet(snippet: string): string[] {
  const lines = snippet.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return [];
  const first = lines[0].trimStart();
  const rest = lines.slice(1);
  const indents = rest
    .filter((line) => line.trim().length > 0)
    .map((line) => (/^[ \t]*/.exec(line) as RegExpExecArray)[0].length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return [first, ...rest.map((line) => (line.trim().length === 0 ? '' : line.slice(common)))];
}

/** 把零缩进片段按给定缩进拼回文本（首行不加前缀，由调用方负责）。 */
function indentLines(lines: string[], indent: string): string {
  return lines.map((line, index) => (index === 0 || line === '' ? line : indent + line)).join('\n');
}

function lineStartOf(code: string, index: number): number {
  return code.lastIndexOf('\n', index - 1) + 1;
}

function lineEndOf(code: string, index: number): number {
  const found = code.indexOf('\n', index);
  return found === -1 ? code.length : found;
}

/** 文件惯用的缩进单位（用于容器没有子元素可参照时）。 */
function detectIndentUnit(code: string): string {
  const match = /\n(\t+|[ ]+)\S/.exec(code);
  if (!match) return '  ';
  return match[1].includes('\t') ? '\t' : match[1];
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export function applyStructure(
  code: string,
  locator: ElementLocator,
  op: StructureOp,
): StructureResult {
  const tree = parseSource(code);
  const located = findJsxElement(tree, locator);
  if (!located.ok) {
    return { status: 'not-found', reason: located.reason, changed: false, edits: [] };
  }

  switch (op.kind) {
    case 'insert':
      return insertSibling(code, located.jsx, op.position, op.snippet);
    case 'insertChild':
      return insertChild(code, located.jsx, op.position, op.snippet);
    case 'duplicate':
      return insertSibling(code, located.jsx, 'after', code.slice(located.jsx.start!, located.jsx.end!));
    case 'delete': {
      // 父元素的路径不会因子元素被删而改变，所以可以在原树上直接取它的锚点
      const parentEntry = located.parent
        ? tree.find((entry) => entry.element === located.parent)
        : undefined;
      return deleteElement(code, located.jsx, parentEntry ? anchorOf(parentEntry.path) : undefined);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 插入：同级
 * ------------------------------------------------------------------ */

function insertSibling(
  code: string,
  target: JSXElement,
  position: 'before' | 'after',
  snippet: string,
): StructureResult {
  const valid = validateSnippet(snippet);
  if (!valid.ok) return { status: 'unresolved', reason: valid.reason, changed: false, edits: [] };

  const start = target.start!;
  const end = target.end!;
  const ls = lineStartOf(code, start);
  const ownIndent = code.slice(ls, start);
  if (!/^[ \t]*$/.test(ownIndent)) {
    return {
      status: 'unresolved',
      reason: '该元素与同级内容挤在同一行，插入会让格式混乱，请先把它拆成独占一行',
      changed: false, edits: [],
    };
  }

  const lines = normalizeSnippet(snippet);
  if (lines.length === 0) return { status: 'unresolved', reason: '要插入的内容是空的', changed: false, edits: [] };

  let edit: SourceEdit;
  let insertedStartInNew: number;
  let insertedText: string;

  if (position === 'before') {
    insertedText = `${ownIndent}${indentLines(lines, ownIndent)}\n`;
    edit = { start: ls, end: ls, before: '', after: insertedText };
    insertedStartInNew = ls;
  } else {
    const le = lineEndOf(code, end);
    insertedText = `\n${ownIndent}${indentLines(lines, ownIndent)}`;
    edit = { start: le, end: le, before: '', after: insertedText };
    // 换行在前，片段从 le+1 开始
    insertedStartInNew = le + 1;
  }

  return finishStructure(code, [edit], insertedStartInNew, insertedText);
}

/* ------------------------------------------------------------------ *
 * 插入：容器内部
 * ------------------------------------------------------------------ */

function insertChild(
  code: string,
  container: JSXElement,
  position: 'first' | 'last',
  snippet: string,
): StructureResult {
  const valid = validateSnippet(snippet);
  if (!valid.ok) return { status: 'unresolved', reason: valid.reason, changed: false, edits: [] };

  const lines = normalizeSnippet(snippet);
  if (lines.length === 0) return { status: 'unresolved', reason: '要插入的内容是空的', changed: false, edits: [] };

  const opening = container.openingElement;
  const closing = container.closingElement;
  const containerLineStart = lineStartOf(code, opening.start!);
  const containerIndent = code.slice(containerLineStart, opening.start!);
  if (!/^[ \t]*$/.test(containerIndent)) {
    return {
      status: 'unresolved',
      reason: '该容器与其它内容挤在同一行，无法判断内部应有的缩进',
      changed: false, edits: [],
    };
  }

  /* 情况 1：自闭合 → 展开成有子元素的形式 */
  if (!closing) {
    const name = code.slice(opening.name.start!, opening.name.end!);
    const slash = findSelfClosingSlash(code, opening.end!);
    if (slash === null) {
      return { status: 'unresolved', reason: '无法定位自闭合标记', changed: false, edits: [] };
    }
    // 连 `/` 前面的空白一起替换，避免产生 `<Card >`
    let replaceFrom = slash;
    while (replaceFrom > opening.start! && /[ \t]/.test(code[replaceFrom - 1])) replaceFrom -= 1;
    const innerIndent = containerIndent + detectIndentUnit(code);
    const insertedText =
      `>\n${innerIndent}${indentLines(lines, innerIndent)}\n${containerIndent}</${name}>`;
    const edit: SourceEdit = {
      start: replaceFrom,
      end: opening.end!,
      before: code.slice(replaceFrom, opening.end!),
      after: insertedText,
    };
    const insertedStartInNew = replaceFrom + 2;
    return finishStructure(code, [edit], insertedStartInNew, insertedText);
  }

  const children = container.children.filter(
    (child) => !(child.type === 'JSXText' && child.value.trim() === ''),
  );

  /* 情况 2：有子元素 → 插到首/尾，缩进照抄邻居 */
  if (children.length > 0) {
    const anchorChild = position === 'first' ? children[0] : children[children.length - 1];
    const childStart = anchorChild.start!;
    const childLineStart = lineStartOf(code, childStart);
    const childIndent = code.slice(childLineStart, childStart);
    if (!/^[ \t]*$/.test(childIndent)) {
      return {
        status: 'unresolved',
        reason: '容器的子元素与其它内容挤在同一行，无法判断缩进',
        changed: false, edits: [],
      };
    }

    if (position === 'first') {
      // 插到首个子元素所在行的行首：新行在它上面
      const insertedText = `${childIndent}${indentLines(lines, childIndent)}\n`;
      const edit: SourceEdit = { start: childLineStart, end: childLineStart, before: '', after: insertedText };
      return finishStructure(code, [edit], childLineStart, insertedText);
    }

    // 插到末个子元素之后：先到它那一行的行尾，再换行
    const childLineEnd = lineEndOf(code, anchorChild.end!);
    const insertedText = `\n${childIndent}${indentLines(lines, childIndent)}`;
    const edit: SourceEdit = { start: childLineEnd, end: childLineEnd, before: '', after: insertedText };
    return finishStructure(code, [edit], childLineEnd + 1, insertedText);
  }

  /* 情况 3：空容器 `<div></div>` → 撑成多行 */
  const innerIndent = containerIndent + detectIndentUnit(code);
  const insertedText = `\n${innerIndent}${indentLines(lines, innerIndent)}\n${containerIndent}`;
  const at = opening.end!;
  const edit: SourceEdit = { start: at, end: at, before: '', after: insertedText };
  return finishStructure(code, [edit], at + 1, insertedText);
}

/** 自闭合标签的 `/` 位置：从 `>` 往回跳空白，应碰到 `/`。 */
function findSelfClosingSlash(code: string, openingEnd: number): number | null {
  let i = openingEnd - 2;
  while (i > 0 && /[ \t]/.test(code[i])) i -= 1;
  return code[i] === '/' ? i : null;
}

/* ------------------------------------------------------------------ *
 * 删除
 * ------------------------------------------------------------------ */

function deleteElement(
  code: string,
  target: JSXElement,
  parentAnchor: string | undefined,
): StructureResult {
  const start = target.start!;
  const end = target.end!;
  const ls = lineStartOf(code, start);
  const le = lineEndOf(code, end);
  const prefix = code.slice(ls, start);
  const suffix = code.slice(end, le);
  const ownLine = /^[ \t]*$/.test(prefix) && /^[ \t]*$/.test(suffix);

  let edit: SourceEdit;
  if (ownLine) {
    // 独占一行（可能跨多行）：连这一行的换行一起删掉，不留空行
    const stop = le < code.length ? le + 1 : le;
    edit = { start: ls, end: stop, before: code.slice(ls, stop), after: '' };
  } else {
    // 与同级挤在一行：只删元素本体，再吃掉一侧的空白
    let from = start;
    let to = end;
    while (from > ls && /[ \t]/.test(code[from - 1])) from -= 1;
    while (to < le && /[ \t]/.test(code[to])) to += 1;
    edit = { start: from, end: to, before: code.slice(from, to), after: '' };
  }

  const updated = applyEdits(code, [edit]);
  if (updated === code) {
    return { status: 'unresolved', reason: '删除没有产生任何变化', changed: false, edits: [] };
  }

  return {
    status: 'ok',
    changed: true,
    code: updated,
    diff: computeDiff(code, updated),
    edits: [edit],
    nextAnchor: parentAnchor,
  };
}

/* ------------------------------------------------------------------ *
 * 落地 + 计算新锚点
 * ------------------------------------------------------------------ */

function finishStructure(
  code: string,
  edits: SourceEdit[],
  insertedStartInNew: number,
  insertedText: string,
): StructureResult {
  const updated = applyEdits(code, edits);
  if (updated === code) {
    return { status: 'unresolved', reason: '插入没有产生任何变化', changed: false, edits: [] };
  }

  // 重新解析，用"字符区间落在插入文本内"识别新元素——比按索引猜可靠
  const limit = insertedStartInNew + insertedText.length;
  const candidates = parseSource(updated)
    .filter((entry) => {
      const at = entry.element.start;
      return typeof at === 'number' && at >= insertedStartInNew && at < limit;
    })
    .sort((a, b) => (a.element.start as number) - (b.element.start as number));

  const inserted = candidates[0];
  return {
    status: 'ok',
    changed: true,
    code: updated,
    diff: computeDiff(code, updated),
    edits,
    newAnchor: inserted ? anchorOf(inserted.path) : undefined,
    newLine: inserted?.line,
    newColumn: inserted?.column,
  };
}
