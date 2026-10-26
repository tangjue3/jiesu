import MagicString from 'magic-string';

import { collectJsxTree, pathToAnchor } from '../locate/jsx-tree.js';

export interface InjectOptions {
  /** 源文件绝对路径 */
  filePath: string;
  /** 项目根目录，用于计算相对路径 */
  rootDir?: string;
  /** 注入的属性名 */
  attribute?: string;
  /** 注入的稳定 id 属性名 */
  idAttribute?: string;
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
const DEFAULT_ID_ATTRIBUTE = 'data-jiesu-id';

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

/** HTML 属性值转义。 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 给每个 JSX 元素注入两样东西：
 *   data-jiesu-src="相对路径:行:列"   —— 精确到元素，但行号会漂移
 *   data-jiesu-id="相对路径#0.1"      —— 结构稳定，行号漂移也不影响
 *
 * 为什么必须自己做（不能靠 React）：
 *  - React 19 已移除 fiber._debugSource / props.__source，运行时拿不到任何源码位置
 *  - @vitejs/plugin-react 虽然发射了 source，但 React 19 直接丢弃
 *  - 编译期注入则完全不依赖 React 内部实现，跨版本稳定
 *
 * 为什么需要 id（src 不够）：
 *  写回代码后文件内容变了，行号随之漂移，`data-jiesu-src` 会失效。
 *  `data-jiesu-id` 基于 JSX 层级结构，只要没有增删同级元素就保持不变。
 */
export function injectSourceAttribute(code: string, options: InjectOptions): InjectResult {
  const attribute = options.attribute ?? DEFAULT_ATTRIBUTE;
  const idAttribute = options.idAttribute ?? DEFAULT_ID_ATTRIBUTE;

  let entries: ReturnType<typeof collectJsxTree>;
  try {
    entries = collectJsxTree(code);
  } catch {
    return { code, injected: 0, tooLate: false };
  }

  // JSX 已不存在，但产物里有 jsxDEV 调用 → 说明注入时机太晚（react 插件先跑了）
  if (entries.length === 0 && /\bjsxDEV\s*\(/.test(code)) {
    return { code, injected: 0, tooLate: true };
  }

  if (entries.length === 0) return { code, injected: 0, tooLate: false };

  const source = toRelativeSource(options.rootDir, options.filePath);
  const magic = new MagicString(code);
  let injected = 0;

  // 从后往前插入，避免偏移失效
  const targets = entries
    .filter((entry) => typeof entry.opening.name.end === 'number' && entry.line > 0)
    .sort((a, b) => (b.opening.name.end as number) - (a.opening.name.end as number));

  for (const entry of targets) {
    const insertAt = entry.opening.name.end as number;
    const srcValue = `${source}:${entry.line}:${entry.column}`;
    const idValue = `${source}#${pathToAnchor(entry.path)}`;
    magic.appendLeft(
      insertAt,
      ` ${attribute}="${escapeAttr(srcValue)}"` + ` ${idAttribute}="${escapeAttr(idValue)}"`,
    );
    injected += 1;
  }

  return {
    code: magic.toString(),
    injected,
    tooLate: false,
    map: magic.generateMap({ hires: true, source: options.filePath }),
  };
}
