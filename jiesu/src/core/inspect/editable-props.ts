import { parseClass } from '../write/tailwind-classes.js';
import {
  ALIGN_ITEMS_VALUES,
  FLEX_DIRECTION_VALUES,
  JUSTIFY_CONTENT_VALUES,
} from '../layout/tw-layout.js';

/**
 * 把元素的 class token 列表，解析成"可编辑属性"清单。
 *
 * 这是 UI 层的输入：面板显示哪些控件、每个控件对应哪个 class、以及改完之后生成什么 op。
 * 纯函数，不碰 DOM——computed 值由调用方传入。
 */

export type EditableKind = 'length' | 'color' | 'fontSize' | 'enum' | 'text';

export interface EditableProp {
  /** 稳定的属性标识 */
  key: string;
  label: string;
  kind: EditableKind;
  /** 对应的 class 的 base 部分（改写时作为 fromBase） */
  base?: string;
  /** enum 型的可选值 */
  options?: string[];
  /** 若是 length 类，对应的类族前缀（p / px / pt …） */
  prefix?: string;
}

const SPACING_SIDES: Array<{ suffix: string; label: string }> = [
  { suffix: 'p', label: '内边距' },
  { suffix: 'px', label: '左右内边距' },
  { suffix: 'py', label: '上下内边距' },
  { suffix: 'pt', label: '上内边距' },
  { suffix: 'pr', label: '右内边距' },
  { suffix: 'pb', label: '下内边距' },
  { suffix: 'pl', label: '左内边距' },
];

const MARGIN_SIDES: Array<{ suffix: string; label: string }> = [
  { suffix: 'm', label: '外边距' },
  { suffix: 'mx', label: '左右外边距' },
  { suffix: 'my', label: '上下外边距' },
  { suffix: 'mt', label: '上外边距' },
  { suffix: 'mr', label: '右外边距' },
  { suffix: 'mb', label: '下外边距' },
  { suffix: 'ml', label: '左外边距' },
];

/** Tailwind 默认字号档位。 */
export const FONT_SIZE_STEPS = [
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
];

/** 常用预设色（Tailwind 语义色），避免引入完整调色板。 */
export const PRESET_COLORS = [
  'text-slate-900',
  'text-slate-600',
  'text-white',
  'text-blue-600',
  'text-emerald-600',
  'text-rose-600',
  'bg-white',
  'bg-slate-50',
  'bg-slate-900',
  'bg-blue-600',
  'bg-emerald-600',
  'bg-rose-600',
];

/**
 * 解析可编辑属性。
 * @param classTokens 元素的 class token 列表（含变体前缀）
 */
export function resolveEditableProps(classTokens: string[]): EditableProp[] {
  const props: EditableProp[] = [];
  const seen = new Set<string>();

  const push = (prop: EditableProp) => {
    if (seen.has(prop.key)) return;
    seen.add(prop.key);
    props.push(prop);
  };

  for (const token of classTokens) {
    const parsed = parseClass(token);
    const base = parsed.base;

    // 内边距 / 外边距
    const pad = SPACING_SIDES.find((s) => base.startsWith(`${s.suffix}-`));
    if (pad && !base.includes('[')) {
      push({
        key: `padding-${pad.suffix}`,
        label: pad.label,
        kind: 'length',
        base,
        prefix: pad.suffix,
      });
      continue;
    }
    const margin = MARGIN_SIDES.find((s) => base.startsWith(`${s.suffix}-`));
    if (margin && !base.includes('[')) {
      push({
        key: `margin-${margin.suffix}`,
        label: margin.label,
        kind: 'length',
        base,
        prefix: margin.suffix,
      });
      continue;
    }

    // gap
    if (base.startsWith('gap-')) {
      push({ key: 'gap', label: '间距', kind: 'length', base, prefix: base.split('-')[0] });
      continue;
    }

    // 文字：字号 vs 颜色
    if (base.startsWith('text-')) {
      const value = base.slice('text-'.length);
      if (FONT_SIZE_STEPS.includes(value)) {
        push({ key: 'font-size', label: '字号', kind: 'fontSize', base });
      } else {
        push({ key: 'color', label: '文字颜色', kind: 'color', base });
      }
      continue;
    }

    // 背景色
    if (base.startsWith('bg-') && !base.startsWith('bg-opacity')) {
      push({ key: 'background-color', label: '背景色', kind: 'color', base });
      continue;
    }

    // 圆角
    if (base === 'rounded' || base.startsWith('rounded-')) {
      push({ key: 'border-radius', label: '圆角', kind: 'length', base, prefix: 'rounded' });
      continue;
    }

    // 布局枚举
    if (base === 'flex' || (FLEX_DIRECTION_VALUES as readonly string[]).includes(base)) {
      push({
        key: 'flex-direction',
        label: '排列方向',
        kind: 'enum',
        base,
        options: [...FLEX_DIRECTION_VALUES],
      });
      continue;
    }
    if ((ALIGN_ITEMS_VALUES as readonly string[]).includes(base)) {
      push({
        key: 'align-items',
        label: '对齐',
        kind: 'enum',
        base,
        options: [...ALIGN_ITEMS_VALUES],
      });
      continue;
    }
    if ((JUSTIFY_CONTENT_VALUES as readonly string[]).includes(base)) {
      push({
        key: 'justify-content',
        label: '分布',
        kind: 'enum',
        base,
        options: [...JUSTIFY_CONTENT_VALUES],
      });
      continue;
    }
  }

  return props;
}
