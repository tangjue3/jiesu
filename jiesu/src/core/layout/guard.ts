import { parseClass } from '../write/tailwind-classes.js';
import { isForbiddenClass, isForbiddenStyleProp } from './tw-layout.js';

/**
 * 安全闸：布局语义编辑的结果里不允许出现绝对定位类或绝对定位样式。
 *
 * 这是"改布局不改坏响应式"的最后一道防线——即便上游逻辑出 bug，也拦得住。
 */

const CLASS_ATTR_RE = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const STYLE_PROP_RE = /\b(position|left|right|top|bottom|inset|insetInline|insetBlock|translate|zIndex)\s*:/g;

export interface SafetyReport {
  ok: boolean;
  violations: string[];
}

/** 检查一段 class 文本里是否含被禁用的类。 */
export function findForbiddenClasses(classText: string): string[] {
  const hits: string[] = [];
  for (const token of classText.split(/\s+/)) {
    if (!token) continue;
    const base = parseClass(token).base;
    if (isForbiddenClass(base)) hits.push(token);
  }
  return hits;
}

/** 检查整段代码里是否有绝对定位类或绝对定位样式属性。 */
export function auditLayoutSafety(code: string): SafetyReport {
  const violations: string[] = [];

  let match: RegExpExecArray | null;
  CLASS_ATTR_RE.lastIndex = 0;
  while ((match = CLASS_ATTR_RE.exec(code)) !== null) {
    const classText = match[1] ?? match[2] ?? match[3] ?? '';
    for (const bad of findForbiddenClasses(classText)) {
      violations.push(`绝对定位类 ${bad}`);
    }
  }

  STYLE_PROP_RE.lastIndex = 0;
  while ((match = STYLE_PROP_RE.exec(code)) !== null) {
    const prop = match[1];
    if (isForbiddenStyleProp(prop)) {
      violations.push(`绝对定位样式 ${prop}`);
    }
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}
