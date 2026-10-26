/**
 * Tailwind class → 具体 px 数值。
 *
 * 为什么需要它：面板要显示"当前值"（例如间距 12px），
 * 但**不能只靠 computed style**——用户项目可能没装 Tailwind，
 * 或者样式被覆盖 / 被层叠规则改掉，computed 值会失真。
 *
 * 代码才是唯一真实来源：class 里写着 gap-3，就是 12px。
 */

/** 间距刻度：n * 4px（v3 / v4 一致，默认 0.25rem 基数）。 */
const SPACING_PATTERN =
  /^(?:gap-x|gap-y|gap|px|py|pt|pr|pb|pl|p|mx|my|mt|mr|mb|ml|m)-(\d+(?:\.\d+)?)$/;

/** 字号刻度（16px 根字号）。 */
export const FONT_SIZE_PX: Record<string, number> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
  'text-4xl': 36,
  'text-5xl': 48,
};

/** 圆角刻度。 */
export const RADIUS_PX: Record<string, number> = {
  rounded: 4,
  'rounded-none': 0,
  'rounded-sm': 2,
  'rounded-md': 6,
  'rounded-lg': 8,
  'rounded-xl': 12,
  'rounded-2xl': 16,
  'rounded-3xl': 24,
  'rounded-full': 9999,
};

/** 把 class 的 base 部分翻译成 px；无法确定时返回 null。 */
export function classToPx(base: string): number | null {
  const spacing = SPACING_PATTERN.exec(base);
  if (spacing) {
    const scale = Number(spacing[1]);
    if (Number.isFinite(scale)) return Math.round(scale * 4);
  }
  if (base in FONT_SIZE_PX) return FONT_SIZE_PX[base];
  if (base in RADIUS_PX) return RADIUS_PX[base];
  return null;
}
