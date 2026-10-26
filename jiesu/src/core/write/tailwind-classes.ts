/**
 * Tailwind class token 的解析与分类。
 *
 * 目标：给定一个 class token，回答"它管什么"（类别），从而支持"把间距从 16px 改成 24px"
 * 这类语义操作只动同一类别的类，不误伤其它类（例如 p-4 与 px-4、与 text-sm 与 text-white）。
 */

export type StyleCategory =
  | 'spacing'
  | 'size'
  | 'color'
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'radius'
  | 'borderWidth'
  | 'shadow'
  | 'layout'
  | 'unknown';

/** 变体前缀（hover: md: dark: 等），用于在替换时保留。 */
const VARIANT_PATTERN = /^((?:[a-z0-9-]+:)+)(.*)$/;

export interface ParsedClass {
  /** 完整 token，如 `md:hover:p-4` */
  raw: string;
  /** 变体前缀，如 `md:hover:` */
  variants: string;
  /** 去掉变体后的基础部分，如 `p-4` */
  base: string;
  category: StyleCategory;
}

const FONT_SIZE_VALUES = new Set([
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
]);

const FONT_FAMILY_VALUES = new Set([
  'sans', 'serif', 'mono', 'cursive', 'fantasy',
  'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
]);

const FONT_WEIGHT_VALUES = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
]);

const RADIUS_VALUES = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full']);

const SHADOW_VALUES = new Set(['sm', 'md', 'lg', 'xl', '2xl', 'inner', 'none']);

const BORDER_WIDTH_VALUES = new Set(['0', '2', '4', '8']);

const COLOR_PREFIXES = [
  'bg-', 'text-', 'border-', 'fill-', 'stroke-', 'ring-', 'outline-', 'divide-',
  'accent-', 'caret-', 'placeholder-', 'from-', 'to-', 'via-', 'decoration-', 'shadow-',
];

const SPACING_PREFIXES = [
  'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-',
  'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-',
  'gap-', 'gap-x-', 'gap-y-', 'space-x-', 'space-y-',
  'inset-', 'inset-x-', 'inset-y-', 'top-', 'right-', 'bottom-', 'left-',
  'translate-x-', 'translate-y-',
];

const SIZE_PREFIXES = ['w-', 'h-', 'size-', 'min-w-', 'max-w-', 'min-h-', 'max-h-', 'basis-'];

const LAYOUT_WORDS = new Set([
  'flex', 'grid', 'block', 'inline', 'inline-block', 'inline-flex', 'inline-grid',
  'hidden', 'contents', 'table', 'flow-root',
]);

/** 颜色名与色阶（含任意值写法）。用于区分 text-white（颜色）与 text-sm（字号）。 */
const COLOR_VALUE_PATTERN =
  /^(?:[a-z]+-\d{2,3}(?:-\d{2,3})?|[a-z]+|current|inherit|transparent|black|white)$/;

function startsWithAny(base: string, prefixes: string[]): boolean {
  return prefixes.some((p) => base.startsWith(p));
}

/** 判断某个前缀族里，取值部分是否是"颜色"。 */
function isColorValue(value: string): boolean {
  if (value.startsWith('[')) return true; // 任意值，如 bg-[#fff] / text-[clamp(...)]
  return COLOR_VALUE_PATTERN.test(value);
}

export function classifyBaseClass(base: string): StyleCategory {
  if (base.length === 0) return 'unknown';
  if (LAYOUT_WORDS.has(base)) return 'layout';

  // 圆角：rounded / rounded-md / rounded-t-lg
  if (base === 'rounded' || base.startsWith('rounded-')) {
    const value = base === 'rounded' ? '' : base.slice('rounded-'.length);
    if (value === '' || RADIUS_VALUES.has(value) || /^(t|r|b|l|tl|tr|br|bl)-/.test(value)) {
      return 'radius';
    }
  }

  // 阴影：shadow / shadow-md / shadow-blue-500（后者是颜色）
  if (base === 'shadow' || base.startsWith('shadow-')) {
    const value = base === 'shadow' ? '' : base.slice('shadow-'.length);
    if (value === '' || SHADOW_VALUES.has(value)) return 'shadow';
    if (isColorValue(value)) return 'color';
  }

  // 字体
  if (base.startsWith('font-')) {
    const value = base.slice('font-'.length);
    if (FONT_FAMILY_VALUES.has(value)) return 'fontFamily';
    if (FONT_WEIGHT_VALUES.has(value)) return 'fontWeight';
    // font-[...] 任意值：可能是字号也可能是字重，无法确定
    return 'unknown';
  }

  // 文字：text-* 既可能是颜色也可能是字号
  if (base.startsWith('text-')) {
    const value = base.slice('text-'.length);
    if (FONT_SIZE_VALUES.has(value)) return 'fontSize';
    if (isColorValue(value)) return 'color';
    if (value.startsWith('[')) return 'fontSize'; // text-[13px] 更可能是字号
    return 'unknown';
  }

  // 边框：border-2 是宽度，border-red-500 是颜色
  if (base.startsWith('border-')) {
    const value = base.slice('border-'.length);
    if (BORDER_WIDTH_VALUES.has(value)) return 'borderWidth';
    if (value.startsWith('x-') || value.startsWith('y-') || value.startsWith('t-') ||
        value.startsWith('r-') || value.startsWith('b-') || value.startsWith('l-')) {
      const inner = value.slice(2);
      if (BORDER_WIDTH_VALUES.has(inner)) return 'borderWidth';
      if (isColorValue(inner)) return 'color';
    }
    if (isColorValue(value)) return 'color';
    return 'unknown';
  }

  if (base === 'border') return 'borderWidth';

  // 颜色系
  for (const prefix of COLOR_PREFIXES) {
    if (base.startsWith(prefix)) {
      const value = base.slice(prefix.length);
      if (value === '') continue;
      // text- 已在上面处理
      if (prefix === 'text-') continue;
      return isColorValue(value) ? 'color' : 'unknown';
    }
  }

  // 尺寸
  if (startsWithAny(base, SIZE_PREFIXES)) return 'size';

  // 间距
  if (startsWithAny(base, SPACING_PREFIXES)) {
    const value = base.slice(base.indexOf('-') + 1);
    // w-1/2 这类分数在 size 里已处理；这里只关心数值与任意值
    if (value === '' || /^-?[\d.]+$/.test(value) || value.startsWith('[')) return 'spacing';
    return 'unknown';
  }

  // 布局相关：flex 方向、对齐、order、span 等
  if (
    base.startsWith('items-') || base.startsWith('justify-') || base.startsWith('content-') ||
    base.startsWith('self-') || base.startsWith('place-') || base.startsWith('order-') ||
    base.startsWith('col-') || base.startsWith('row-') || base === 'grow' || base === 'shrink' ||
    base === 'flex-1' || base === 'flex-auto' || base === 'flex-none' || base.startsWith('flex-')
  ) {
    return 'layout';
  }

  return 'unknown';
}

export function parseClass(raw: string): ParsedClass {
  const match = VARIANT_PATTERN.exec(raw);
  const variants = match?.[1] ?? '';
  const base = match?.[2] ?? raw;
  return { raw, variants, base, category: classifyBaseClass(base) };
}

export function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter((t) => t.length > 0);
}

export function joinClasses(tokens: string[]): string {
  return tokens.join(' ');
}

/** 在 token 列表中查找同类别、且基础部分等于 from 的 token。 */
export function findByCategoryAndBase(
  tokens: string[],
  category: StyleCategory,
  fromBase: string,
): string[] {
  return tokens.filter((token) => {
    const parsed = parseClass(token);
    return parsed.category === category && parsed.base === fromBase;
  });
}

/**
 * 生成替换后的 token：保留变体前缀，只换基础部分。
 * `md:hover:p-4` → `md:hover:p-6`
 */
export function replaceBase(token: string, newBase: string): string {
  const parsed = parseClass(token);
  return `${parsed.variants}${newBase}`;
}
