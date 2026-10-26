/**
 * 选中态锚点：HMR 之后如何找回"刚才选中的那个元素"。
 *
 * 问题背景：
 *   写回代码 → Vite 触发 HMR → React 重渲染 → 原 DOM 节点被替换、
 *   class 变化、行号漂移。此时 `element` 引用指向的可能是已脱离文档的旧节点。
 *
 * 解法：选中时记下一组"指纹"，重渲染后按指纹重新找回元素。
 * 指纹从强到弱：
 *   1. data-jiesu-id   —— 编译期注入的结构锚点（文件#路径），最精确
 *   2. 结构锚点 path    —— 与上者同源，作为 id 缺失时的降级
 *   3. 文本指纹         —— 元素自身文本内容，用于 id 完全缺失时兜底
 *
 * 纪律：找不到就明说"元素已不存在"，绝不随便挑一个元素顶上。
 */

/** 一个元素的指纹集合。 */
export interface ElementFingerprint {
  /** 编译期注入的稳定 id，如 "src/App.tsx#0.1" */
  stableId: string | null;
  /** 结构锚点，如 "0.1" */
  anchor: string | null;
  /** 元素自身直接文本（不含后代），用于兜底匹配 */
  ownText: string;
  /** 标签名 */
  tagName: string;
}

export interface FingerprintMatch {
  element: HTMLElement;
  /** 命中方式，用于告知用户可信度 */
  matchedBy: 'stableId' | 'anchor' | 'text';
}

/** 取元素的直接文本（只取直属文本节点，不含子元素）。 */
export function ownTextOf(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) text += node.textContent ?? '';
  }
  return text.trim().slice(0, 120);
}

/** 采集元素的指纹。 */
export function fingerprintOf(el: Element): ElementFingerprint {
  const stableId = el.getAttribute('data-jiesu-id');
  const src = el.getAttribute('data-jiesu-src');
  // id 形如 "src/App.tsx#0.1"，锚点是 # 之后的部分
  const hashIndex = stableId ? stableId.lastIndexOf('#') : -1;
  const anchor =
    hashIndex >= 0 ? stableId!.slice(hashIndex + 1) : src && src.includes('#') ? src.slice(src.lastIndexOf('#') + 1) : null;
  return {
    stableId,
    anchor,
    ownText: ownTextOf(el),
    tagName: el.tagName.toLowerCase(),
  };
}

/**
 * 在给定的根节点下，按指纹找回元素。
 *
 * @param root 搜索范围（通常是 document.body）
 * @param fingerprint 选中时的指纹
 */
export function findByFingerprint(
  root: ParentNode,
  fingerprint: ElementFingerprint,
): FingerprintMatch | null {
  // 1. 稳定 id —— 编译期注入，跨 HMR 完全稳定
  if (fingerprint.stableId) {
    const hit = root.querySelector(`[data-jiesu-id="${cssEscape(fingerprint.stableId)}"]`);
    if (hit instanceof HTMLElement) return { element: hit, matchedBy: 'stableId' };
  }

  // 2. 结构锚点 —— 与稳定 id 同源，id 属性缺失时降级
  if (fingerprint.anchor) {
    const candidates = Array.from(
      root.querySelectorAll('[data-jiesu-src]'),
    ).filter((el) => {
      const src = el.getAttribute('data-jiesu-src') ?? '';
      const hashIndex = src.lastIndexOf('#');
      const candidateAnchor = hashIndex >= 0 ? src.slice(hashIndex + 1) : '';
      return candidateAnchor === fingerprint.anchor;
    });
    if (candidates.length === 1) {
      return { element: candidates[0] as HTMLElement, matchedBy: 'anchor' };
    }
  }

  // 3. 文本指纹 —— 只在唯一匹配时采用
  if (fingerprint.ownText) {
    const candidates = Array.from(root.querySelectorAll(fingerprint.tagName)).filter(
      (el) => ownTextOf(el) === fingerprint.ownText,
    );
    if (candidates.length === 1) {
      return { element: candidates[0] as HTMLElement, matchedBy: 'text' };
    }
  }

  return null;
}

/** CSS 选择器里的字符串转义。 */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * 判断元素是否仍在文档中。
 * HMR 替换节点后，旧节点会脱离文档（isConnected = false）。
 */
export function isStillAttached(el: Element): boolean {
  return el.isConnected;
}
