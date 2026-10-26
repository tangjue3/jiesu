/**
 * 组件模板库 —— 画布"拖组件进来"的落地形态。
 *
 * 产品拍板走「画布即代码」：拖一个组件进来，等于往用户的 TSX 里插入一段真实 JSX，
 * 不存在"导出"这一步。所以这里的每一项**就是一段可插入的代码**，不是 JSON schema。
 *
 * 约束（由 core/write/structure.ts 强制）：
 *  - 每个 snippet 必须是**单根** JSX 元素（多根无法确定插入边界）
 *  - 不能带 import：模板只能用到用户项目里已有的东西（HTML 标签 + Tailwind 类）
 *  - 不能含业务逻辑：插进去的是可继续用鼠标编辑的静态结构，逻辑留给用户自己写
 */

export type ComponentGroup = '基础' | '表单' | '展示' | '布局';

export interface ComponentTemplate {
  id: string;
  name: string;
  group: ComponentGroup;
  /** 单根 JSX 片段，可直接作为插入内容 */
  snippet: string;
  /** 搜索关键词（中英混排，方便按记忆搜） */
  tags: string[];
}

export const COMPONENT_TEMPLATES: ComponentTemplate[] = [
  {
    id: 'heading',
    name: '标题',
    group: '基础',
    snippet: '<h2 className="text-xl font-semibold text-slate-900">标题</h2>',
    tags: ['标题', 'heading', 'h2', '文字'],
  },
  {
    id: 'paragraph',
    name: '段落',
    group: '基础',
    snippet: '<p className="text-sm leading-6 text-slate-600">这里是一段说明文字。</p>',
    tags: ['段落', 'paragraph', 'text', '文字'],
  },
  {
    id: 'button',
    name: '按钮',
    group: '表单',
    snippet:
      '<button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">按钮</button>',
    tags: ['按钮', 'button', 'action'],
  },
  {
    id: 'input',
    name: '输入框',
    group: '表单',
    snippet:
      '<input className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" placeholder="请输入" />',
    tags: ['输入', 'input', '表单', 'form'],
  },
  {
    id: 'badge',
    name: '徽章',
    group: '展示',
    snippet:
      '<span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">标签</span>',
    tags: ['徽章', 'badge', 'tag', '标签'],
  },
  {
    id: 'card',
    name: '卡片',
    group: '展示',
    snippet: `<div className="rounded-lg border border-slate-200 bg-white p-4">
  <h3 className="text-base font-semibold text-slate-900">卡片标题</h3>
  <p className="mt-1 text-sm text-slate-600">卡片内容。</p>
</div>`,
    tags: ['卡片', 'card', '容器'],
  },
  {
    id: 'divider',
    name: '分隔线',
    group: '基础',
    snippet: '<hr className="border-t border-slate-200" />',
    tags: ['分隔线', 'divider', 'hr', '线'],
  },
  {
    id: 'two-column',
    name: '双列栅格',
    group: '布局',
    snippet: `<div className="grid grid-cols-2 gap-4">
  <div className="rounded-lg bg-slate-50 p-4">左栏</div>
  <div className="rounded-lg bg-slate-100 p-4">右栏</div>
</div>`,
    tags: ['栅格', 'grid', 'column', '布局', '两列'],
  },
  {
    id: 'stack',
    name: '纵向堆叠',
    group: '布局',
    snippet: `<div className="flex flex-col gap-3">
  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">第一项</div>
  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">第二项</div>
</div>`,
    tags: ['堆叠', 'stack', 'flex', '布局', '纵向'],
  },
];

/** 按 id 取模板；找不到返回 undefined（调用方必须显式处理，不猜）。 */
export function findTemplate(id: string): ComponentTemplate | undefined {
  return COMPONENT_TEMPLATES.find((item) => item.id === id);
}

/** 按关键词过滤；空关键词返回全部。标签、名称、id 都参与匹配。 */
export function searchTemplates(keyword: string): ComponentTemplate[] {
  const q = keyword.trim().toLowerCase();
  if (q.length === 0) return [...COMPONENT_TEMPLATES];
  return COMPONENT_TEMPLATES.filter((item) => {
    if (item.name.toLowerCase().includes(q)) return true;
    if (item.id.includes(q)) return true;
    return item.tags.some((tag) => tag.toLowerCase().includes(q));
  });
}

/** 按分组归类（UI 里分组展示用）。保持 COMPONENT_TEMPLATES 的原始顺序。 */
export function groupTemplates(): Array<{ group: ComponentGroup; items: ComponentTemplate[] }> {
  const order: ComponentGroup[] = ['基础', '表单', '展示', '布局'];
  return order
    .map((group) => ({ group, items: COMPONENT_TEMPLATES.filter((item) => item.group === group) }))
    .filter((entry) => entry.items.length > 0);
}
