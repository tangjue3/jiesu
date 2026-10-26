import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { JSXOpeningElement } from '@babel/types';

export interface InjectOptions {
  /** 源文件绝对路径 */
  filePath: string;
  /** 项目根目录，用于计算相对路径 */
  rootDir?: string;
  /** 注入的属性名 */
  attribute?: string;
}

export interface InjectResult {
  code: string;
  /** 注入的 JSX 元素数量 */
  injected: number;
  /** 是否检测到"JSX 已被编译、无法定位"的信号 */
  tooLate: boolean;
  /** sourcemap，保证不破坏用户项目的调试链路 */
  map?: ReturnType<MagicString['generateMap']>;
}

const DEFAULT_ATTRIBUTE = 'data-jiesu-src';

/** 相对路径，统一用 posix 分隔符，避免 Windows 路径进 HTML 属性。 */
export function toRelativeSource(rootDir: string | undefined, filePath: string): string {
  if (!rootDir) return filePath;
  const normalizedRoot = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRootPosix = normalizedRoot.replace(/\\/g, '/');
  return normalizedFile.startsWith(normalizedRootPosix)
    ? normalizedFile.slice(normalizedRootPosix.length)
    : normalizedFile;
}

function collectJsxOpeningElements(code: string): JSXOpeningElement[] {
  const ast = parse(code, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins: ['typescript', 'jsx'],
  });
  const out: JSXOpeningElement[] = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string };
    if (n.type === 'JSXOpeningElement') {
      out.push(node as JSXOpeningElement);
    }
    for (const key of Object.keys(node as object)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };

  visit(ast);
  return out;
}

/**
 * 给每个 JSX 元素注入 `data-jiesu-src="相对路径:行:列"`。
 *
 * 为什么必须自己做（不能靠 React）：
 *  - React 19 已移除 fiber._debugSource / props.__source，运行时拿不到任何源码位置
 *  - @vitejs/plugin-react 虽然发射了 source，但 React 19 直接丢弃
 *  - 编译期注入则完全不依赖 React 内部实现，跨版本稳定
 */
export function injectSourceAttribute(code: string, options: InjectOptions): InjectResult {
  const attribute = options.attribute ?? DEFAULT_ATTRIBUTE;

  let elements: JSXOpeningElement[];
  try {
    elements = collectJsxOpeningElements(code);
  } catch {
    return { code, injected: 0, tooLate: false };
  }

  // JSX 已不存在，但产物里有 jsxDEV 调用 → 说明注入时机太晚（react 插件先跑了）
  if (elements.length === 0 && /\bjsxDEV\s*\(/.test(code)) {
    return { code, injected: 0, tooLate: true };
  }

  if (elements.length === 0) return { code, injected: 0, tooLate: false };

  const source = toRelativeSource(options.rootDir, options.filePath);
  const magic = new MagicString(code);
  let injected = 0;

  // 从后往前插入，避免偏移失效
  const targets = elements
    .filter((el) => {
      const name = el.name;
      return typeof name.end === 'number' && el.loc?.start?.line;
    })
    .sort((a, b) => (b.name.end as number) - (a.name.end as number));

  for (const el of targets) {
    const line = el.loc!.start.line;
    const column = el.loc!.start.column;
    const insertAt = el.name.end as number;
    magic.appendLeft(insertAt, ` ${attribute}="${source}:${line}:${column}"`);
    injected += 1;
  }

  return {
    code: magic.toString(),
    injected,
    tooLate: false,
    map: magic.generateMap({ hires: true, source: options.filePath }),
  };
}
