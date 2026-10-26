/**
 * 单位桥接：computed style 给的是 px，Tailwind 代码里是类名。
 * Tailwind v3 / v4 的 spacing 基数都是 0.25rem = 4px（默认 16px 根字号）。
 */

export const SPACING_STEP_PX = 4;

/** 16px → '4'；12px → '3'；24px → '6'；2px → '0.5'。不能整除到 2px 粒度时返回 null。 */
export function pxToSpacingScale(px: number): string | null {
  if (!Number.isFinite(px)) return null;
  if (px === 0) return '0';
  if (Math.abs(px % 2) > 1e-9) return null; // 只能到 2px 粒度
  const n = px / SPACING_STEP_PX;
  return String(n);
}

/**
 * 把 px 值翻译成某个类族的 Tailwind 类名。
 * 例：spacing + 24px → 'p-6'；radius + 8px → 'rounded-lg'（Tailwind 半径刻度固定，非线性）。
 */
export function pxToTailwindClass(
  category: 'spacing' | 'radius',
  prefix: string,
  px: number,
): string | null {
  if (category === 'spacing') {
    const scale = pxToSpacingScale(px);
    if (scale === null) return null;
    return `${prefix}-${scale}`;
  }
  // 圆角刻度：none 0, sm 2, md 6, lg 8, xl 12, 2xl 16, 3xl 24, full 9999
  const radiusScale: Array<[number, string]> = [
    [0, 'none'], [2, 'sm'], [4, 'md'], [6, 'md'], [8, 'lg'], [12, 'xl'],
    [16, '2xl'], [24, '3xl'],
  ];
  const exact = radiusScale.find(([v]) => v === px);
  if (exact) return `${prefix}-${exact[1]}`;
  if (px >= 9999) return `${prefix}-full`;
  return null;
}
