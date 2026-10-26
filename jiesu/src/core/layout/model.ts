/**
 * 布局上下文推断。
 *
 * core 是纯 TS（无 DOM），因此只能从 class token 推断元素自身的布局角色；
 * "父容器是不是 flex/grid"这类信息由 UI 层（能读 computed style）传进来。
 */

export type Display = 'flex' | 'inline-flex' | 'grid' | 'inline-grid' | 'block' | 'other';

export interface LayoutContext {
  display: Display;
  isFlexContainer: boolean;
  isGridContainer: boolean;
  /** 是否存在 flex/grid 相关类（用于判断"这个元素根本没参与布局"） */
  hasLayoutClasses: boolean;
}

export function inferLayoutContext(tokens: string[]): LayoutContext {
  let display: Display = 'other';
  let hasLayoutClasses = false;

  for (const token of tokens) {
    const base = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
    switch (base) {
      case 'flex':
        display = 'flex';
        hasLayoutClasses = true;
        break;
      case 'inline-flex':
        display = 'inline-flex';
        hasLayoutClasses = true;
        break;
      case 'grid':
        display = 'grid';
        hasLayoutClasses = true;
        break;
      case 'inline-grid':
        display = 'inline-grid';
        hasLayoutClasses = true;
        break;
      case 'block':
        display = 'block';
        break;
      case 'hidden':
        display = 'other';
        break;
      default:
        if (/^(flex|grid|col-|row-|gap|items-|justify-|self-|order-)/.test(base)) {
          hasLayoutClasses = true;
        }
    }
  }

  return {
    display,
    isFlexContainer: display === 'flex' || display === 'inline-flex',
    isGridContainer: display === 'grid' || display === 'inline-grid',
    hasLayoutClasses,
  };
}

/** 操作的前置条件。 */
export interface LayoutRequirements {
  /** 元素自身必须是这种容器 */
  container?: 'flex' | 'grid';
  /** 元素必须是这种容器的子项 */
  parent?: 'flex' | 'grid';
}

export interface RequirementCheck {
  ok: boolean;
  reason?: string;
}

export function checkRequirements(
  ctx: LayoutContext,
  req: LayoutRequirements,
  parentCtx?: LayoutContext,
): RequirementCheck {
  if (req.container === 'flex' && !ctx.isFlexContainer) {
    return {
      ok: false,
      reason: `该容器当前不是 flex 布局（display: ${ctx.display}），无法调整 flex 属性`,
    };
  }
  if (req.container === 'grid' && !ctx.isGridContainer) {
    return {
      ok: false,
      reason: `该容器当前不是 grid 布局（display: ${ctx.display}），无法调整网格属性`,
    };
  }
  if (req.parent === 'flex') {
    if (!parentCtx) {
      return { ok: false, reason: '无法确定父容器是否为 flex 布局' };
    }
    if (!parentCtx.isFlexContainer) {
      return { ok: false, reason: '父容器不是 flex 布局，子项排序不适用' };
    }
  }
  if (req.parent === 'grid') {
    if (!parentCtx) {
      return { ok: false, reason: '无法确定父容器是否为 grid 布局' };
    }
    if (!parentCtx.isGridContainer) {
      return { ok: false, reason: '父容器不是 grid 布局，网格属性不适用' };
    }
  }
  return { ok: true };
}
