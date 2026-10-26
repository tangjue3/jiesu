import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectJsx, locateByClassToken, staticClassText } from '../../spikes/s2/helpers';
import { inferLayoutContext } from '../../src/core/layout/model';
import type { LayoutContext } from '../../src/core/layout/model';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');

export const readFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), 'utf8');

/** 取出代码里所有 class token（忽略空白与顺序）。 */
export function classTokens(code: string): string[] {
  const tokens: string[] = [];
  const re = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    tokens.push(...text.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

/** 构造"父容器是 flex"的上下文，用于 order / childOrder 操作。 */
export function flexParent(): LayoutContext {
  return inferLayoutContext(['flex']);
}

export function gridParent(): LayoutContext {
  return inferLayoutContext(['grid']);
}

/** 定位容器内的第 n 个 JSX 子元素（按文档顺序，不含空白文本节点）。 */
export function locateChildByIndex(code: string, containerToken: string, index: number) {
  const hits = collectJsx(code).filter((h) =>
    (staticClassText(h.el) ?? '').split(/\s+/).includes(containerToken),
  );
  if (hits.length === 0) throw new Error(`找不到容器: ${containerToken}`);
  const container = hits[0];
  if (!container.parent) throw new Error('容器没有子元素');

  const children = container.parent.children.filter(
    (c) => !(c.type === 'JSXText' && c.value.trim().length === 0),
  );
  const child = children[index];
  if (!child) throw new Error(`容器内没有第 ${index} 个子元素`);

  // 找到该子元素对应的 openingElement
  const opening =
    child.type === 'JSXElement' ? child.openingElement : null;
  if (!opening?.loc?.start) throw new Error('子元素缺少位置信息');

  return {
    filePath: 'fixture.tsx',
    line: opening.loc.start.line,
    column: opening.loc.start.column,
  };
}

export { locateByClassToken };
