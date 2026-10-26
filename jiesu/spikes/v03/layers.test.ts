/**
 * 图层树构建的单元测试（jsdom 里造 DOM，不需要浏览器）。
 *
 * 重点验证过滤规则：既没有源码锚点、也没有可保留子元素的节点必须被丢掉，
 * 但用来承载层级的中间节点必须留下——否则树会断链。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import {
  buildLayerTree,
  countEditable,
  keyChainOf,
  ownText,
  parseLayerId,
  shouldSkipTag,
  summarizeClass,
  type LayerNode,
} from '../../src/client/layers';

/** 造一个带源码锚点的元素。 */
function el(html: string, id?: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const node = template.content.firstElementChild as HTMLElement;
  if (id) {
    node.setAttribute('data-jiesu-id', id);
    node.setAttribute('data-jiesu-src', `${id.split('#')[0]}:1:0`);
  }
  return node;
}

function names(node: LayerNode | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  const walk = (item: LayerNode): void => {
    out.push(item.tag);
    item.children.forEach(walk);
  };
  walk(node);
  return out;
}

describe('图层标签摘要', () => {
  it('只取前两个 token', () => {
    expect(summarizeClass('flex items-center justify-between gap-4')).toBe('flex.items-center');
  });

  it('丢掉变体前缀（md:/hover:）——图层面板里它们是噪音', () => {
    expect(summarizeClass('md:flex hover:bg-white p-4')).toBe('p-4');
  });

  it('没有可用 token 时返回空串', () => {
    expect(summarizeClass('')).toBe('');
    expect(summarizeClass('   ')).toBe('');
  });
});

describe('锚点解析', () => {
  it('拆出文件与锚点', () => {
    expect(parseLayerId('src/App.tsx#0.1')).toEqual({
      file: 'src/App.tsx',
      anchor: '0.1',
    });
  });

  it('缺少 # 或为空时返回 null，绝不猜', () => {
    expect(parseLayerId(null)).toBeNull();
    expect(parseLayerId('src/App.tsx')).toBeNull();
    expect(parseLayerId('#0.1')).toBeNull();
  });
});

describe('结构噪音过滤', () => {
  it('脚本/样式/换行等不进图层树', () => {
    expect(shouldSkipTag('SCRIPT')).toBe(true);
    expect(shouldSkipTag('style')).toBe(true);
    expect(shouldSkipTag('br')).toBe(true);
  });

  it('正常元素保留', () => {
    expect(shouldSkipTag('div')).toBe(false);
    expect(shouldSkipTag('H2')).toBe(false);
  });
});

describe('树构建', () => {
  it('保留有锚点的节点与其层级', () => {
    const root = el('<div><h2>标题</h2><p>说明</p></div>', 'App.tsx#0');
    const h2 = root.children[0] as HTMLElement;
    h2.setAttribute('data-jiesu-id', 'App.tsx#0.0');
    const p = root.children[1] as HTMLElement;
    p.setAttribute('data-jiesu-id', 'App.tsx#0.1');

    const tree = buildLayerTree(root);
    expect(names(tree)).toEqual(['div', 'h2', 'p']);
    expect(tree?.anchor).toBe('0');
    expect(tree?.children.map((c) => c.anchor)).toEqual(['0.0', '0.1']);
  });

  it('无锚点但有锚点子元素：保留作为层级（否则树断链）', () => {
    const root = el('<div><section><span>文字</span></section></div>');
    const section = root.children[0] as HTMLElement;
    const span = section.children[0] as HTMLElement;
    span.setAttribute('data-jiesu-id', 'App.tsx#0.0.0');

    const tree = buildLayerTree(root);
    expect(names(tree)).toEqual(['div', 'section', 'span']);
    expect(tree?.anchor).toBeNull();
    expect(tree?.children[0].anchor).toBeNull();
    expect(tree?.children[0].children[0].anchor).toBe('0.0.0');
  });

  it('既无锚点又无子元素：丢弃（第三方库产生的零散节点）', () => {
    const root = el('<div><div></div><span id="keep">x</span></div>', 'App.tsx#0');
    const keep = root.querySelector('#keep') as HTMLElement;
    keep.setAttribute('data-jiesu-id', 'App.tsx#0.1');

    const tree = buildLayerTree(root);
    expect(names(tree)).toEqual(['div', 'span']);
    expect(tree?.children).toHaveLength(1);
  });

  it('跳过 script，不因为它打断了结构', () => {
    const root = el('<div><script>1</script><p>文字</p></div>', 'App.tsx#0');
    (root.children[1] as HTMLElement).setAttribute('data-jiesu-id', 'App.tsx#0.1');

    expect(names(buildLayerTree(root))).toEqual(['div', 'p']);
  });

  it('key 用 DOM 索引链，组件复用时也不会撞（锚点会重复）', () => {
    const root = el('<div><i></i><i></i></div>', 'App.tsx#0');
    for (const child of Array.from(root.children)) {
      // 同一个组件被复用 → 三个 DOM 元素共享同一个锚点
      (child as HTMLElement).setAttribute('data-jiesu-id', 'Card.tsx#0');
    }
    const tree = buildLayerTree(root);
    expect(tree?.children.map((c) => c.key)).toEqual(['0.0', '0.1']);
    expect(new Set(tree?.children.map((c) => c.anchor)).size).toBe(1);
  });

  it('叶子节点带上自身文本，方便在长树里认人', () => {
    const root = el('<div><p>  卡片一  </p></div>', 'App.tsx#0');
    (root.children[0] as HTMLElement).setAttribute('data-jiesu-id', 'App.tsx#0.0');
    expect(buildLayerTree(root)?.children[0].text).toBe('卡片一');
  });

  it('ownText 只取直接文本，不含子元素文字', () => {
    const host = el('<div>直接<span>嵌套</span></div>');
    expect(ownText(host)).toBe('直接');
  });
});

describe('祖先链与统计', () => {
  it('keyChainOf 返回逐级前缀，用于自动展开', () => {
    const root = el('<div><section><article><h2>x</h2></article></section></div>');
    const h2 = root.querySelector('h2') as HTMLElement;
    expect(keyChainOf(root, h2)).toEqual(['0', '0.0', '0.0.0', '0.0.0.0']);
  });

  it('目标不在该树里时返回空数组（不瞎展开）', () => {
    const root = el('<div><p>x</p></div>');
    const other = el('<div><p>y</p></div>');
    expect(keyChainOf(root, other.querySelector('p') as HTMLElement)).toEqual([]);
  });

  it('countEditable 只数有锚点的节点', () => {
    const root = el('<div><section><span>a</span><span>b</span></section></div>', 'App.tsx#0');
    const section = root.children[0] as HTMLElement;
    (section.children[0] as HTMLElement).setAttribute('data-jiesu-id', 'App.tsx#0.0.0');
    const tree = buildLayerTree(root);
    expect(tree && countEditable([tree])).toBe(2);
  });
});
