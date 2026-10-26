/**
 * 图层面板的数据构建。
 *
 * 数据来源是 **DOM 树**，不是 JSX 源码树 —— 因为覆盖层只能看到渲染结果，
 * 而且 DOM 树天然就是"用户眼睛看到的结构"。
 *
 * 过滤规则（关键）：
 *  - 结构噪音（script/style/br…）直接跳过
 *  - 覆盖层自己跳过
 *  - **既没有源码锚点、又没有（已保留的）子元素**的节点跳过
 *    这样第三方位库生成的零散节点不会污染树，但层级链路完整可导航
 */

export interface LayerNode {
  element: HTMLElement;
  /** 唯一 key：DOM 索引链（不能用 data-jiesu-id，组件复用会让它重复） */
  key: string;
  tag: string;
  /** 类名摘要，如 "flex.gap-4" */
  cls: string;
  /** 自身文本片段（只对叶子有意义） */
  text: string;
  /** 源码锚点；null = 没有源码位置（多为第三方/非 JSX 元素） */
  anchor: string | null;
  /** 锚点所属文件；用于区分"跨文件" */
  file: string | null;
  children: LayerNode[];
}

/** 不进入图层树的结构噪音。 */
const SKIP_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'head',
  'title',
  'noscript',
  'template',
  'br',
  'wbr',
  'base',
]);

export function shouldSkipTag(tagName: string): boolean {
  return SKIP_TAGS.has(tagName.toLowerCase());
}

/**
 * 类名摘要：只取前 max 个"有信息量"的 token。
 *
 * 丢掉带变体前缀的（`md:` / `hover:`）—— 它们在图层面板里是噪音，
 * 但会保留在标签的 title 里供查证。
 */
export function summarizeClass(className: string, max = 2): string {
  const tokens = className
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !token.includes(':'));
  return tokens.slice(0, max).join('.');
}

/** 从 `data-jiesu-id="src/App.tsx#0.1"` 拆出文件名与锚点。 */
export function parseLayerId(id: string | null): { file: string; anchor: string } | null {
  if (!id) return null;
  const hash = id.lastIndexOf('#');
  if (hash <= 0) return null;
  return { file: id.slice(0, hash), anchor: id.slice(hash + 1) };
}

/** 元素自身的直接文本（不含子元素里的文字）。 */
export function ownText(element: HTMLElement, max = 16): string {
  let text = '';
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function buildOne(element: HTMLElement, key: string): LayerNode | null {
  if (shouldSkipTag(element.tagName)) return null;
  if (element.hasAttribute('data-jiesu-overlay')) return null;

  const children: LayerNode[] = [];
  let index = 0;
  for (const child of Array.from(element.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const built = buildOne(child, `${key}.${index}`);
    index += 1;
    if (built) children.push(built);
  }

  const parsed = parseLayerId(element.getAttribute('data-jiesu-id'));
  // 无锚点又无子元素 → 对用户没有意义（编辑不了，也展不开）
  if (!parsed && children.length === 0) return null;

  return {
    element,
    key,
    tag: element.tagName.toLowerCase(),
    cls: summarizeClass(element.className),
    text: children.length === 0 ? ownText(element) : '',
    anchor: parsed?.anchor ?? null,
    file: parsed?.file ?? null,
    children,
  };
}

/**
 * 从容器开始构建图层树（返回容器本身的节点）。
 *
 * key 用 DOM 索引链而非 `data-jiesu-id`：组件被复用时（列表渲染）
 * 多个 DOM 元素会共享同一个锚点，用它做 key 会导致展开状态串台。
 */
export function buildLayerTree(root: HTMLElement): LayerNode | null {
  return buildOne(root, '0');
}

/**
 * 从根到目标元素的 key 链（用于自动展开祖先）。
 *
 * 返回 ['0', '0.2', '0.2.1'] 这样逐级的前缀，调用方把它们全部放进
 * 展开集合，目标元素就会露出来。
 */
export function keyChainOf(root: HTMLElement, target: HTMLElement): string[] {
  const indices: string[] = [];
  let current: HTMLElement | null = target;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return [];
    indices.unshift(String(Array.from(parent.children).indexOf(current)));
    current = parent;
  }
  if (current !== root) return [];

  const keys = ['0'];
  let acc = '0';
  for (const index of indices) {
    acc = `${acc}.${index}`;
    keys.push(acc);
  }
  return keys;
}

/** 统计树里"可编辑"（有源码锚点）的节点数。 */
export function countEditable(nodes: LayerNode[]): number {
  let total = 0;
  const walk = (node: LayerNode): void => {
    if (node.anchor) total += 1;
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return total;
}
