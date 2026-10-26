import type {
  JSXAttribute,
  JSXExpressionContainer,
  JSXOpeningElement,
  StringLiteral,
  TemplateLiteral,
} from '@babel/types';

/**
 * className 的取值形态。
 * 只有静态形态可以确定性改写；其余一律判为 unresolved（宁可说"改不了"，也不猜着改）。
 */
export type ClassNameTarget =
  | { form: 'string'; node: StringLiteral }
  | { form: 'template'; node: TemplateLiteral }
  | { form: 'unresolved'; reason: string };

export function getAttribute(el: JSXOpeningElement, name: string): JSXAttribute | null {
  for (const attr of el.attributes) {
    if (attr.type !== 'JSXAttribute') continue;
    const attrName = attr.name;
    if (attrName.type === 'JSXIdentifier' && attrName.name === name) return attr;
  }
  return null;
}

export function calleeName(expr: unknown): string {
  const e = expr as { type?: string; name?: string; property?: { name?: string } };
  if (e?.type === 'Identifier') return e.name ?? 'unknown';
  if (e?.type === 'MemberExpression') return e.property?.name ?? 'member expression';
  return 'unknown';
}

export function getClassNameTarget(el: JSXOpeningElement): ClassNameTarget {
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
