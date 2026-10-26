/**
 * 拖拽位移的代码落地：把"拖了多少像素"翻译成 Tailwind 的 `translate-x-N` / `translate-y-N`。
 *
 * 为什么用 translate 而不是绝对定位：
 *  - `absolute` 会让元素脱离文档流，父容器塌陷，响应式直接崩坏（这是本产品明令禁止的）
 *  - `translate` 仍在文档流里，只做视觉位移；兄弟元素照常排版，断点布局不受影响
 * 所以"跟着鼠标走"可以做到，但落地的永远是**语义化的位移类**，代码里不会出现一个坐标。
 *
 * 吸附：4px 一个刻度（Tailwind 的 spacing 基数），保证写出来的是 `translate-x-6` 而不是
 * `translate-x-[23px]` 这种脏值。
 */

export const TRANSLATE_STEP_PX = 4;

export interface Translation {
  x: number;
  y: number;
}

/** Tailwind 的 translate 类：`translate-x-2` / `-translate-y-3`。 */
const TRANSLATE_TOKEN_RE = /^-?translate-[xy]-/;

/** 从 class token 列表里读出当前位移（只认无变体的 base 类）。 */
export function parseTranslate(tokens: string[]): Translation {
  let x = 0;
  let y = 0;
  for (const token of tokens) {
    if (token.includes(':')) continue;
    const match = /^(-?)translate-([xy])-(.+)$/.exec(token);
    if (!match) continue;
    const scale = Number(match[3]);
    if (!Number.isFinite(scale)) continue;
    const px = (match[1] === '-' ? -1 : 1) * scale * TRANSLATE_STEP_PX;
    if (match[2] === 'x') x = px;
    else y = px;
  }
  return { x, y };
}

/**
 * 吸附到 4px 刻度（拖拽过程中就吸附，所见即所得，松手不跳变）。
 *
 * 负数按绝对值取整再还原符号：`Math.round(-1.5)` 在 JS 里是 -1，
 * 会导致"往左拖 6px 变成 4px、往右拖 6px 变成 8px"的不对称手感。
 */
export function snapPx(px: number): number {
  if (!Number.isFinite(px)) return 0;
  const sign = px < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(px) / TRANSLATE_STEP_PX) * TRANSLATE_STEP_PX;
}

/** px → 单个轴的 translate 类；0 表示"没有位移"，返回 null。 */
export function translateClass(axis: 'x' | 'y', px: number): string | null {
  if (px === 0) return null;
  const scale = Math.abs(px) / TRANSLATE_STEP_PX;
  if (!Number.isInteger(scale)) return null;
  return `${px < 0 ? '-' : ''}translate-${axis}-${scale}`;
}

export interface SetTranslateResult {
  ok: boolean;
  text: string;
  changed: boolean;
  reason?: string;
}

/** 删掉一个 token，顺带吃掉相邻的一个空格，避免留下双空格。 */
function removeTokenAt(text: string, start: number, end: number): string {
  let from = start;
  let to = end;
  if (from > 0 && text[from - 1] === ' ') from -= 1;
  else if (to < text.length && text[to] === ' ') to += 1;
  return text.slice(0, from) + text.slice(to);
}

/**
 * 生成新的 class 文本：只动 translate 相关的 token，其余字符逐字节保留。
 *
 * 这样一次拖拽在 git diff 里就只是"多了两个类"，而不是整行 className 被重写。
 */
export function setTranslate(text: string, xPx: number, yPx: number): SetTranslateResult {
  const snappedX = snapPx(xPx);
  const snappedY = snapPx(yPx);

  const wanted: string[] = [];
  for (const [axis, px] of [
    ['x', snappedX],
    ['y', snappedY],
  ] as const) {
    if (px === 0) continue;
    const cls = translateClass(axis, px);
    if (!cls) {
      return {
        ok: false,
        text,
        changed: false,
        reason: `${px}px 无法映射到 translate 刻度（需要 4px 粒度）`,
      };
    }
    wanted.push(cls);
  }

  // 找出所有 translate token 的位置
  const spans: Array<{ start: number; end: number }> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (TRANSLATE_TOKEN_RE.test(match[0])) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  // 没有任何位移、也没有目标位移 → 不需要改
  if (spans.length === 0 && wanted.length === 0) {
    return { ok: true, text, changed: false };
  }

  if (spans.length === 0) {
    const trimmed = text.replace(/\s+$/, '');
    const next = `${trimmed}${trimmed ? ' ' : ''}${wanted.join(' ')}`;
    return { ok: true, text: next, changed: next !== text };
  }

  // 从后往前删，保证前面的偏移量不失效
  const insertAt = spans[0].start;
  let out = text;
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    out = removeTokenAt(out, spans[i].start, spans[i].end);
  }

  if (wanted.length === 0) {
    return { ok: true, text: out, changed: out !== text };
  }

  const head = out.slice(0, insertAt);
  const tail = out.slice(insertAt);
  const prefix = head && !head.endsWith(' ') ? `${head} ` : head;
  const joined = `${prefix}${wanted.join(' ')}`;
  const next = tail && !tail.startsWith(' ') ? `${joined} ${tail}` : `${joined}${tail}`;
  return { ok: true, text: next, changed: next !== text };
}
