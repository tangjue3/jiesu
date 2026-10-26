import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LayoutContext } from '../../src/core/layout/model';
import { inferLayoutContext } from '../../src/core/layout/model';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');

export const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

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

/** 构造"父容器是 grid"的上下文，用于 col-span / row-span 操作。 */
export function gridParent(): LayoutContext {
  return inferLayoutContext(['grid']);
}
