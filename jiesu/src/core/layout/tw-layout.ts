/**
 * Tailwind 布局类族（family）定义。
 *
 * "族"是布局语义的基本单位：一个族代表一个布局属性（如 flex 方向、对齐方式），
 * 改写时**只替换同族的一个类**，不动其它类，也绝不引入 position/left/top 这类绝对定位。
 */

export type LayoutValue = string | number;

export interface Family {
  /** 族名，用于报错信息 */
  name: string;
  /** 判断某个 class 的 base 是否属于该族 */
  matches: (base: string) => boolean;
  /** 生成该族的目标类（不含变体前缀） */
  build: (value: LayoutValue) => string | null;
  /** 该族是否允许"原本不存在时新增" */
  allowCreate: boolean;
}

const inSet = (set: string[]) => (base: string) => set.includes(base);
const numericSuffix = (prefix: string) => (base: string) =>
  new RegExp(`^${prefix}-\\d+(\\.\\d+)?$`).test(base);

export const FLEX_DIRECTION_VALUES = [
  'flex-row',
  'flex-col',
  'flex-row-reverse',
  'flex-col-reverse',
] as const;

export const ALIGN_ITEMS_VALUES = [
  'items-start',
  'items-center',
  'items-end',
  'items-stretch',
  'items-baseline',
] as const;

export const JUSTIFY_CONTENT_VALUES = [
  'justify-start',
  'justify-center',
  'justify-end',
  'justify-between',
  'justify-around',
  'justify-evenly',
] as const;

/** 族表：key 是操作名。 */
export const FAMILIES: Record<string, Family> = {
  flexDirection: {
    name: 'flex 方向',
    // Tailwind 里 `flex` 等价于 `flex-row`，两者同族
    matches: (base) => base === 'flex' || (FLEX_DIRECTION_VALUES as readonly string[]).includes(base),
    build: (v) => (FLEX_DIRECTION_VALUES as readonly string[]).includes(String(v)) ? String(v) : null,
    allowCreate: false,
  },
  alignItems: {
    name: '交叉轴对齐',
    matches: inSet([...ALIGN_ITEMS_VALUES]),
    build: (v) => (ALIGN_ITEMS_VALUES as readonly string[]).includes(String(v)) ? String(v) : null,
    allowCreate: false,
  },
  justifyContent: {
    name: '主轴分布',
    matches: inSet([...JUSTIFY_CONTENT_VALUES]),
    build: (v) => (JUSTIFY_CONTENT_VALUES as readonly string[]).includes(String(v)) ? String(v) : null,
    allowCreate: false,
  },
  gap: {
    name: '间距 gap',
    // gap / gap-x / gap-y / gap-2 …
    matches: (base) => /^gap(-[xy])?(-[\d.]+)?$/.test(base),
    build: (v) => {
      const scale = String(v);
      if (!/^\d+(\.\d+)?$/.test(scale)) return null;
      return `gap-${scale}`;
    },
    allowCreate: false,
  },
  order: {
    name: '排序 order',
    matches: numericSuffix('order'),
    build: (v) => (Number.isInteger(Number(v)) ? `order-${v}` : null),
    allowCreate: true,
  },
  gridColumnSpan: {
    name: '网格列跨度',
    matches: numericSuffix('col-span'),
    build: (v) => (Number.isInteger(Number(v)) ? `col-span-${v}` : null),
    allowCreate: false,
  },
  gridColumnStart: {
    name: '网格列起始',
    matches: numericSuffix('col-start'),
    build: (v) => (Number.isInteger(Number(v)) ? `col-start-${v}` : null),
    allowCreate: false,
  },
  gridColumnEnd: {
    name: '网格列结束',
    matches: numericSuffix('col-end'),
    build: (v) => (Number.isInteger(Number(v)) ? `col-end-${v}` : null),
    allowCreate: false,
  },
  gridRowSpan: {
    name: '网格行跨度',
    matches: numericSuffix('row-span'),
    build: (v) => (Number.isInteger(Number(v)) ? `row-span-${v}` : null),
    allowCreate: false,
  },
  gridRowStart: {
    name: '网格行起始',
    matches: numericSuffix('row-start'),
    build: (v) => (Number.isInteger(Number(v)) ? `row-start-${v}` : null),
    allowCreate: false,
  },
  gridRowEnd: {
    name: '网格行结束',
    matches: numericSuffix('row-end'),
    build: (v) => (Number.isInteger(Number(v)) ? `row-end-${v}` : null),
    allowCreate: false,
  },
  gridCols: {
    name: '网格列数',
    matches: numericSuffix('grid-cols'),
    build: (v) => (Number.isInteger(Number(v)) ? `grid-cols-${v}` : null),
    allowCreate: false,
  },
  gridRows: {
    name: '网格行数',
    matches: numericSuffix('grid-rows'),
    build: (v) => (Number.isInteger(Number(v)) ? `grid-rows-${v}` : null),
    allowCreate: false,
  },
};

/**
 * 绝对定位类黑名单。
 * 布局语义编辑**绝不允许**产出这些类——这是"改布局不改坏响应式"的最后一道闸。
 */
export const FORBIDDEN_CLASSES = [
  'absolute',
  'fixed',
  'sticky',
  'static',
  'relative',
];

/** 绝对定位相关的属性名前缀（用于 inline style 检查）。 */
export const FORBIDDEN_STYLE_PROPS = [
  'position',
  'left',
  'right',
  'top',
  'bottom',
  'inset',
  'insetInline',
  'insetBlock',
  'translate',
  'zIndex',
];

export function isForbiddenClass(base: string): boolean {
  if (FORBIDDEN_CLASSES.includes(base)) return true;
  // left-0 / top-4 / inset-x-2 之类
  return /^(left|right|top|bottom|inset|inset-x|inset-y|translate-x|translate-y)-/.test(base);
}

export function isForbiddenStyleProp(prop: string): boolean {
  return FORBIDDEN_STYLE_PROPS.includes(prop);
}
