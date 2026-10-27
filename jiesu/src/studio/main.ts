/**
 * Studio 浏览器端逻辑（画布页 + 代码页）。
 *
 * 三条纪律（与内核一致）：
 *  1. **不猜**：地址不合法就不打开，并说清哪里不对，不做"自动补全成 https://"这种猜测
 *  2. **不假装**：未实现的页面显示"即将上线"，不做假界面糊弄
 *  3. **数据只从服务端来**：变更列表、撤销都走 /api/*，不在前端自己维护一份影子状态
 */

import {
  COMPONENT_TEMPLATES,
  groupTemplates,
  searchTemplates,
  type ComponentTemplate,
} from '../core/library/components.js';

interface SelectionInfo {
  locator: { filePath: string; line: number; column: number; anchor?: string };
  tag: string;
  label: string;
}

interface ChangeRecord {
  id: string;
  filePath: string;
  summary: string;
  before: string;
  after: string;
  diff: { startLine: number; endLine: number; before: string; after: string };
  createdAt: number;
}

interface DeviceSpec {
  label: string;
  width: number;
  height: number;
}

const DEVICES: Record<string, DeviceSpec> = {
  desktop: { label: '桌面', width: 1440, height: 900 },
  tablet: { label: '平板', width: 834, height: 1000 },
  mobile: { label: '手机', width: 390, height: 844 },
};

const PAGE_TITLES: Record<string, { title: string; sub: string }> = {
  canvas: { title: '画布', sub: '真实页面，改的就是源码' },
  code: { title: '代码同步', sub: '每次改动都可逐条撤销' },
  home: { title: '首页', sub: '即将上线' },
  projects: { title: '项目', sub: '即将上线' },
  components: { title: '组件', sub: '插入的是一段真实 JSX' },
  styles: { title: '样式', sub: '即将上线' },
  responsive: { title: '适配', sub: '即将上线' },
  ai: { title: 'AI', sub: '即将上线' },
  settings: { title: '设置', sub: '即将上线' },
};

const store = {
  get url(): string {
    return localStorage.getItem('jiesu.studio.url') ?? '';
  },
  set url(value: string) {
    localStorage.setItem('jiesu.studio.url', value);
  },
  get device(): string {
    return localStorage.getItem('jiesu.studio.device') ?? 'desktop';
  },
  set device(value: string) {
    localStorage.setItem('jiesu.studio.device', value);
  },
};

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Studio 骨架缺少 ${selector}`);
  return el as T;
};

const state = {
  page: 'canvas',
  device: store.device,
  changes: [] as ChangeRecord[],
  selectedId: null as string | null,
  /** 画布当前选中的元素（真源在覆盖层，这里只是订阅） */
  selection: null as SelectionInfo | null,
  /** 组件库筛选状态 */
  libQuery: '',
  libGroup: '全部',
  templateId: COMPONENT_TEMPLATES[0]?.id ?? '',
};

let socket: WebSocket | null = null;

/* ---------------- 页面切换 ---------------- */

function switchPage(id: string): void {
  const meta = PAGE_TITLES[id];
  const implemented = id === 'canvas' || id === 'code' || id === 'components';
  state.page = implemented ? id : 'todo';

  for (const button of document.querySelectorAll<HTMLElement>('[data-nav]')) {
    button.classList.toggle('on', button.dataset.nav === id);
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-page]')) {
    section.classList.toggle('on', section.dataset.page === state.page);
  }

  $('#page-title').textContent = meta?.title ?? id;
  $('#page-sub').textContent = meta?.sub ?? '';

  if (!implemented) {
    $('#todo-title').textContent = `${meta?.title ?? id} · 即将上线`;
    $('#todo-desc').textContent =
      '这一页还没做。先做画布与代码同步——它们是产品是否成立的关键，其余六页等这两页跑通再说。';
  }
  if (state.page === 'code') void loadChanges();
  if (state.page === 'components') renderLibrary();
}

/* ---------------- 画布 ---------------- */

function normalizeUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: '请先填写地址' };
  // 用户最容易漏的就是协议前缀。`new URL('localhost:5173')` 其实会解析成功
  // （把 localhost 当成协议名），所以必须先自己判一次，才能给出有用的提示。
  if (!/^https?:\/\//i.test(value)) {
    return { ok: false, reason: '地址要以 http:// 或 https:// 开头' };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: '地址格式不对，需要形如 http://localhost:5173' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: '只支持 http / https 地址' };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * 桌面画板不写死 1440：可视区比 1440 窄时按可视区来。
 * 否则 iframe 右半边（含覆盖层面板）会跑到画布外面，用户得横向滚动才能看到属性面板。
 */
function frameWidth(device: string): number {
  const spec = DEVICES[device] ?? DEVICES.desktop;
  if (device !== 'desktop') return spec.width;
  const stage = document.getElementById('stage');
  const available = stage ? stage.clientWidth - 40 : spec.width;
  return Math.max(320, Math.min(spec.width, available));
}

function applyDevice(device: string): void {
  const spec = DEVICES[device] ?? DEVICES.desktop;
  state.device = device;
  store.device = device;

  for (const button of document.querySelectorAll<HTMLElement>('#device-switch button')) {
    button.classList.toggle('on', button.dataset.device === device);
  }

  const width = frameWidth(device);
  const frame = $('#frame');
  frame.style.width = `${width}px`;
  const iframe = $<HTMLIFrameElement>('#canvas-frame');
  iframe.style.height = `${spec.height}px`;
  $('#frame-label').textContent =
    device === 'desktop' ? `${spec.label} · ${width}（自适应）` : `${spec.label} · ${width}×${spec.height}`;
}

function openUrl(raw: string): void {
  const result = normalizeUrl(raw);
  if (!result.ok) {
    showToast(result.reason);
    return;
  }
  store.url = result.url;
  $<HTMLInputElement>('#url-input').value = result.url;

  const iframe = $<HTMLIFrameElement>('#canvas-frame');
  iframe.src = result.url;
  $('#canvas-empty').style.display = 'none';
  $('#frame').style.display = 'flex';
  applyDevice(state.device);
}

/* ---------------- 代码同步 ---------------- */

async function loadChanges(): Promise<void> {
  try {
    const res = await fetch('/api/changes');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { changes: ChangeRecord[] };
    state.changes = data.changes;
    if (state.selectedId && !state.changes.some((c) => c.id === state.selectedId)) {
      state.selectedId = null;
    }
    if (!state.selectedId && state.changes.length > 0) {
      state.selectedId = state.changes[state.changes.length - 1].id;
    }
    renderChanges();
  } catch (error) {
    $('#change-count').textContent = '变更篮 · 读取失败';
    $('#change-items').innerHTML = `<div class="empty"><p>${String(error)}</p></div>`;
  }
}

function renderChanges(): void {
  const items = $('#change-items');
  const count = $('#change-count');
  count.textContent = state.changes.length === 0 ? '变更篮 · 空' : `变更篮 · ${state.changes.length} 条`;

  if (state.changes.length === 0) {
    items.innerHTML = `<div class="empty">
      <p>还没有改动。打开画布页，按 <code>Alt+Shift+J</code> 选中元素改一改，这里就会出现记录。</p>
    </div>`;
    $('#diff-view').innerHTML = `<div class="title">左侧会列出每一次改动，点一条看具体动了哪几行。</div>`;
    return;
  }

  items.innerHTML = '';
  for (const change of [...state.changes].reverse()) {
    const row = document.createElement('div');
    row.className = `change${change.id === state.selectedId ? ' on' : ''}`;
    row.dataset.changeId = change.id;
    row.innerHTML = `
      <div class="body">
        <div class="sum">${escapeHtml(change.summary)}</div>
        <div class="meta">${escapeHtml(change.filePath)}:${change.diff.startLine}</div>
      </div>`;
    row.onclick = () => {
      state.selectedId = change.id;
      renderChanges();
    };
    items.appendChild(row);
  }

  renderDiff();
}

function renderDiff(): void {
  const view = $('#diff-view');
  const change = state.changes.find((item) => item.id === state.selectedId);
  if (!change) {
    view.innerHTML = '';
    return;
  }

  const lines: string[] = [];
  const beforeLines = change.diff.before.split('\n');
  const afterLines = change.diff.after.split('\n');
  for (const line of beforeLines) {
    if (line.length > 0) lines.push(`<div class="row del">- ${escapeHtml(line)}</div>`);
  }
  for (const line of afterLines) {
    if (line.length > 0) lines.push(`<div class="row add">+ ${escapeHtml(line)}</div>`);
  }

  view.innerHTML = `
    <div class="title">
      ${escapeHtml(change.summary)} · ${escapeHtml(change.filePath)}:${change.diff.startLine}
      <button class="btn" id="undo-btn" style="margin-left:10px">撤销这条</button>
    </div>
    ${lines.join('') || '<div class="row same">（这条改动没有可显示的行差异）</div>'}`;

  const undo = $('#undo-btn');
  undo.onclick = () => void undoChange(change.id);
}

async function undoChange(changeId: string): Promise<void> {
  const first = document.getElementById('undo-btn') as HTMLButtonElement | null;
  if (first) first.disabled = true;
  try {
    const res = await fetch('/api/undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changeId }),
    });
    const data = (await res.json()) as { ok?: boolean; message?: string };
    if (!res.ok || !data.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
    state.selectedId = null;
    await loadChanges();
  } catch (error) {
    showToast(`撤销失败：${String(error instanceof Error ? error.message : error)}`);
  } finally {
    // 列表可能已经重绘，旧的按钮节点已经不在了——按下标重查而不是复用旧引用
    const again = document.getElementById('undo-btn') as HTMLButtonElement | null;
    if (again) again.disabled = false;
  }
}

/* ---------------- 组件库 ---------------- */

/** 卡片上只显示片段的第一行，剩下的在详情里看。 */
function firstLine(snippet: string): string {
  const line = snippet.split('\n')[0].trim();
  return line.length > 64 ? `${line.slice(0, 64)}…` : line;
}

function visibleTemplates(): ComponentTemplate[] {
  const matched = searchTemplates(state.libQuery);
  if (state.libGroup === '全部') return matched;
  return matched.filter((template) => template.group === state.libGroup);
}

function renderLibrary(): void {
  renderGroups();

  const target = $('#lib-target');
  if (state.selection) {
    const { label, locator } = state.selection;
    target.innerHTML =
      `插入目标：<b>${escapeHtml(label)}</b>` +
      `<span>${escapeHtml(locator.filePath)}:${locator.line}</span>`;
  } else {
    target.innerHTML =
      '<span class="warn">还没选中元素</span>' +
      '<span>先在画布页点一个元素——插入需要它当参照（上方 / 下方 / 内部）</span>';
  }

  const grid = $('#lib-grid');
  const items = visibleTemplates();
  if (items.length === 0) {
    grid.innerHTML = '<div class="lib-empty">没有匹配的组件</div>';
  } else {
    grid.innerHTML = '';
    for (const template of items) {
      const card = document.createElement('button');
      card.className = `card${template.id === state.templateId ? ' on' : ''}`;
      card.dataset.template = template.id;
      card.innerHTML =
        `<div class="name">${escapeHtml(template.name)}</div>` +
        `<div class="group">${escapeHtml(template.group)}</div>` +
        `<div class="code">${escapeHtml(firstLine(template.snippet))}</div>`;
      card.onclick = () => {
        state.templateId = template.id;
        renderLibrary();
      };
      grid.appendChild(card);
    }
  }

  renderDetail();
}

function renderGroups(): void {
  const box = $('#lib-groups');
  const groups = ['全部', ...groupTemplates().map((entry) => entry.group)];
  box.innerHTML = '';
  for (const group of groups) {
    const chip = document.createElement('button');
    chip.className = `chip${group === state.libGroup ? ' on' : ''}`;
    chip.dataset.group = group;
    chip.textContent = group;
    chip.onclick = () => {
      state.libGroup = group;
      renderLibrary();
    };
    box.appendChild(chip);
  }
}

function renderDetail(): void {
  const box = $('#lib-detail');
  const template = COMPONENT_TEMPLATES.find((item) => item.id === state.templateId);
  if (!template) {
    box.innerHTML = '<div class="lib-empty">选一个组件看详情</div>';
    return;
  }

  const disabled = state.selection ? '' : ' disabled';
  box.innerHTML = `
    <h3>${escapeHtml(template.name)}</h3>
    <div class="tags">
      <span class="tag">${escapeHtml(template.group)}</span>
      ${template.tags.slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
    </div>
    <pre>${escapeHtml(template.snippet)}</pre>
    <div class="lib-actions">
      <button class="btn" data-pos="before"${disabled}>上方</button>
      <button class="btn" data-pos="after"${disabled}>下方</button>
      <button class="btn primary" data-pos="last"${disabled}>插到内部</button>
    </div>
    <div class="lib-hint">
      插入的是<b>真实代码</b>：会往源文件里写这一段 JSX，画布立刻热更新，代码页可逐条撤销。
      ${state.selection ? '' : '当前没有插入目标，先在画布上选中一个元素。'}
    </div>`;

  for (const button of box.querySelectorAll<HTMLButtonElement>('[data-pos]')) {
    button.onclick = () => {
      const position = button.dataset.pos as 'before' | 'after' | 'last';
      insertTemplate(template, position);
    };
  }
}

function insertTemplate(template: ComponentTemplate, position: 'before' | 'after' | 'last'): void {
  if (!state.selection) {
    showToast('先在画布上选中一个元素，插入需要它作为参照');
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast('与编辑服务的连接已断开，无法插入');
    return;
  }

  const op =
    position === 'last'
      ? { kind: 'insertChild', position: 'last', snippet: template.snippet }
      : { kind: 'insert', position, snippet: template.snippet };
  const where = position === 'before' ? '上方' : position === 'after' ? '下方' : '内部';

  socket.send(
    JSON.stringify({
      type: 'requestStructure',
      payload: {
        locator: state.selection.locator,
        op,
        summary: `插入 ${template.name}（${where}）`,
      },
    }),
  );
  showToast(`正在插入 ${template.name}（${where}）…`);
}

/* ---------------- 反馈与连接 ---------------- */

let toastTimer: number | null = null;

function showToast(message: string): void {
  let toast = document.getElementById('studio-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'studio-toast';
    toast.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:26px', 'transform:translateX(-50%)',
      'background:#1F2937', 'color:#fff', 'padding:8px 14px', 'border-radius:8px',
      'font-size:12px', 'box-shadow:0 8px 24px rgba(16,24,40,.18)', 'z-index:9',
      'opacity:0', 'transition:opacity .16s',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.style.opacity = '0';
  }, 2600);
}

/** Studio 自己也连一次服务：画布里的编辑一落地，代码页就能立刻看到。 */
function connect(): void {
  const port = (window as unknown as { __JIESU_PORT__?: number }).__JIESU_PORT__;
  const dot = $('#ws-dot');
  const text = $('#ws-text');

  if (!port) {
    dot.classList.add('bad');
    text.textContent = '未注入端口';
    return;
  }

  socket = new WebSocket(`ws://${location.hostname}:${port}/ws`);
  socket.onopen = () => {
    dot.classList.add('ok');
    text.textContent = '已连接';
  };
  socket.onclose = () => {
    dot.classList.remove('ok');
    dot.classList.add('bad');
    text.textContent = '连接断开';
  };
  socket.onmessage = (event) => {
    let message: { type: string; payload?: { selection?: SelectionInfo | null; message?: string } };
    try {
      message = JSON.parse(String(event.data)) as typeof message;
    } catch {
      return;
    }

    switch (message.type) {
      // 覆盖层上报的选中态：组件页的"插入目标"靠它
      case 'selection':
        state.selection = message.payload?.selection ?? null;
        if (state.page === 'components') renderLibrary();
        break;
      case 'changeApplied':
      case 'changeUndone':
        if (state.page === 'code') void loadChanges();
        break;
      case 'error':
        showToast(String(message.payload?.message ?? '操作失败'));
        break;
      default:
        break;
    }
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- 启动 ---------------- */

function boot(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-nav]')) {
    button.onclick = () => switchPage(button.dataset.nav ?? 'canvas');
  }
  for (const button of document.querySelectorAll<HTMLElement>('#device-switch button')) {
    button.onclick = () => applyDevice(button.dataset.device ?? 'desktop');
  }

  $<HTMLInputElement>('#lib-search').addEventListener('input', (event) => {
    state.libQuery = (event.target as HTMLInputElement).value;
    renderLibrary();
  });

  $('#open-btn').onclick = () => openUrl($<HTMLInputElement>('#url-input').value);
  $<HTMLInputElement>('#url-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openUrl($<HTMLInputElement>('#url-input').value);
  });

  // 支持 ?url= 直接进画布（方便从 CLI 或文档里点一个链接就到位）
  const params = new URLSearchParams(location.search);
  const initialUrl = params.get('url') ?? store.url;
  if (initialUrl) {
    $<HTMLInputElement>('#url-input').value = initialUrl;
    openUrl(initialUrl);
  }
  applyDevice(state.device);

  // 窗口变宽变窄时重算桌面画板宽度
  window.addEventListener('resize', () => {
    if ($('#frame').style.display !== 'none') applyDevice(state.device);
  });

  const initialPage = params.get('page');
  switchPage(initialPage === 'code' || initialPage === 'components' ? initialPage : 'canvas');

  connect();
}

boot();
