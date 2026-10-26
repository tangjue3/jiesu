import {
  FONT_SIZE_STEPS,
  PRESET_COLORS,
  resolveEditableProps,
  type EditableProp,
} from '../core/inspect/editable-props.js';
import { classToPx } from '../core/inspect/tw-px.js';
import type { ChangeRecord, ClientMessage, ElementLocator, ServerMessage } from '../server/protocol.js';

/* ------------------------------------------------------------------ *
 * 覆盖层 UI
 * ------------------------------------------------------------------ */

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.jd-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; font-size: 12px; color: #1a1a1a; }
.jd-hl { position: fixed; border: 1px solid #2563eb; background: rgba(37,99,235,.12); border-radius: 2px; pointer-events: none; display: none; }
.jd-hl.sel { border-color: #ea580c; background: rgba(234,88,12,.14); border-width: 1.5px; }
.jd-tag { position: fixed; background: #2563eb; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 11px; line-height: 1.5; white-space: nowrap; pointer-events: none; display: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.jd-tag.sel { background: #ea580c; }
.jd-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 268px; background: #fff; border-left: 1px solid rgba(0,0,0,.12); box-shadow: -2px 0 12px rgba(0,0,0,.06); pointer-events: auto; display: none; flex-direction: column; }
.jd-panel.on { display: flex; }
.jd-head { padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,.08); display: flex; align-items: center; justify-content: space-between; }
.jd-title { font-weight: 500; font-size: 12px; }
.jd-src { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #64748b; padding: 8px 12px; word-break: break-all; border-bottom: 1px solid rgba(0,0,0,.06); }
.jd-body { flex: 1; overflow-y: auto; padding: 8px 0 16px; }
.jd-sec { padding: 6px 12px 2px; font-size: 11px; color: #94a3b8; letter-spacing: .04em; }
.jd-row { padding: 4px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jd-row label { color: #475569; flex: 1; }
.jd-row input[type=number], .jd-row input[type=text], .jd-row select { width: 104px; padding: 3px 6px; border: 1px solid rgba(0,0,0,.16); border-radius: 4px; font-size: 12px; }
.jd-row textarea { width: 100%; padding: 4px 6px; border: 1px solid rgba(0,0,0,.16); border-radius: 4px; font-size: 12px; resize: vertical; }
.jd-sw { display: flex; gap: 4px; flex-wrap: wrap; }
.jd-sw button { width: 18px; height: 18px; border-radius: 3px; border: 1px solid rgba(0,0,0,.16); cursor: pointer; padding: 0; }
.jd-sw button.on { outline: 2px solid #2563eb; outline-offset: 1px; }
.jd-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid rgba(0,0,0,.16); background: #fff; cursor: pointer; font-size: 12px; }
.jd-btn.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.jd-btn:disabled { opacity: .45; cursor: not-allowed; }
.jd-basket { position: fixed; left: 12px; bottom: 12px; min-width: 220px; max-width: 460px; background: #fff; border: 1px solid rgba(0,0,0,.12); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.12); pointer-events: auto; display: none; }
.jd-basket.on { display: block; }
.jd-bhead { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; cursor: pointer; }
.jd-blist { max-height: 220px; overflow-y: auto; border-top: 1px solid rgba(0,0,0,.08); }
.jd-bitem { padding: 7px 10px; border-bottom: 1px solid rgba(0,0,0,.05); display: flex; align-items: flex-start; gap: 8px; }
.jd-bitem .jd-sum { flex: 1; }
.jd-bitem .jd-file { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #94a3b8; }
.jd-basket .jd-bempty { padding: 10px; color: #94a3b8; }
.jd-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #111827; color: #fff; padding: 8px 14px; border-radius: 6px; pointer-events: none; display: none; max-width: 60vw; }
.jd-toast.err { background: #b91c1c; }
.jd-hint { position: fixed; left: 12px; top: 12px; background: rgba(17,24,39,.92); color: #fff; padding: 7px 11px; border-radius: 6px; pointer-events: none; display: none; }
.jd-hint.on { display: block; }
`;

interface Selected {
  element: HTMLElement;
  locator: ElementLocator;
  props: EditableProp[];
}

class JiesuOverlay {
  private root: ShadowRoot;
  private host: HTMLDivElement;
  private hl: HTMLDivElement;
  private tag: HTMLDivElement;
  private panel!: HTMLDivElement;
  private basket!: HTMLDivElement;
  private basketList!: HTMLDivElement;
  private basketCount!: HTMLSpanElement;
  private toast!: HTMLDivElement;
  private hint!: HTMLDivElement;

  private ws!: WebSocket;
  private selecting = false;
  private selected: Selected | null = null;
  private changes: ChangeRecord[] = [];
  private basketOpen = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-jiesu-overlay', '');
    document.documentElement.appendChild(this.host);
    this.root = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STYLE;
    this.root.appendChild(style);

    const rootEl = document.createElement('div');
    rootEl.className = 'jd-root';
    this.root.appendChild(rootEl);

    this.hl = document.createElement('div');
    this.hl.className = 'jd-hl';
    this.tag = document.createElement('div');
    this.tag.className = 'jd-tag';
    rootEl.append(this.hl, this.tag);

    this.hint = document.createElement('div');
    this.hint.className = 'jd-hint';
    this.hint.textContent = 'jiesu：点击元素进行编辑 · Esc 退出';
    rootEl.appendChild(this.hint);

    this.buildPanel();
    this.buildBasket();
    this.buildToast();
  }

  /* ---------------- 连接 ---------------- */

  connect(port: number): void {
    const url = `ws://127.0.0.1:${port}/ws`;
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      this.handleServerMessage(message);
    });
    this.ws.addEventListener('close', () => this.showToast('与 jiesu 服务的连接已断开', true));
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'ready':
        this.showToast('jiesu 已连接，按 Alt+Shift+J 开始选择元素');
        break;
      case 'changeApplied':
        this.changes.push(message.payload.change);
        this.renderBasket();
        this.showToast(`已应用：${message.payload.change.summary}`);
        break;
      case 'changeUndone':
        this.changes = this.changes.filter((c) => c.id !== message.payload.changeId);
        this.renderBasket();
        break;
      case 'history':
        this.changes = message.payload.changes;
        this.renderBasket();
        break;
      case 'error':
        this.showToast(message.payload.message, true);
        break;
      default:
        break;
    }
  }

  /* ---------------- 选择模式 ---------------- */

  toggleSelecting(): void {
    this.selecting = !this.selecting;
    this.hint.classList.toggle('on', this.selecting);
    if (!this.selecting) {
      this.hl.style.display = 'none';
      this.tag.style.display = 'none';
      this.closePanel();
    }
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.selecting) return;
    const target = event.target as HTMLElement | null;
    if (!target || target === this.host) return;
    if (this.host.contains(target)) return;

    const rect = target.getBoundingClientRect();
    this.hl.classList.remove('sel');
    this.hl.style.display = 'block';
    this.hl.style.left = `${rect.left}px`;
    this.hl.style.top = `${rect.top}px`;
    this.hl.style.width = `${rect.width}px`;
    this.hl.style.height = `${rect.height}px`;

    const src = target.getAttribute('data-jiesu-src');
    this.tag.classList.remove('sel');
    this.tag.style.display = 'block';
    this.tag.style.left = `${rect.left}px`;
    this.tag.style.top = `${Math.max(0, rect.top - 20)}px`;
    this.tag.textContent = src ? shortSrc(src) : `${target.tagName.toLowerCase()}（无法定位源码）`;
  };

  private onClick = (event: MouseEvent): void => {
    if (!this.selecting) return;
    const target = event.target as HTMLElement | null;
    if (!target || this.host.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();

    const src = target.getAttribute('data-jiesu-src');
    if (!src) {
      this.showToast('该元素没有源码位置信息，无法编辑', true);
      return;
    }

    const locator = parseSourceAttr(src);
    const props = resolveEditableProps(target.className.split(/\s+/).filter(Boolean));
    this.selected = { element: target, locator, props };

    const rect = target.getBoundingClientRect();
    this.hl.classList.add('sel');
    this.hl.style.display = 'block';
    this.hl.style.left = `${rect.left}px`;
    this.hl.style.top = `${rect.top}px`;
    this.hl.style.width = `${rect.width}px`;
    this.hl.style.height = `${rect.height}px`;
    this.tag.classList.add('sel');
    this.tag.style.display = 'block';
    this.tag.style.left = `${rect.left}px`;
    this.tag.style.top = `${Math.max(0, rect.top - 20)}px`;
    this.tag.textContent = shortSrc(src);

    this.renderPanel();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.selecting) this.toggleSelecting();
      this.closePanel();
      return;
    }
    const isToggle = event.altKey && event.shiftKey && event.key.toLowerCase() === 'j';
    if (isToggle) {
      event.preventDefault();
      this.toggleSelecting();
    }
  };

  /* ---------------- 面板 ---------------- */

  private buildPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'jd-panel';
    this.root.appendChild(this.panel);
  }

  private closePanel(): void {
    this.panel.classList.remove('on');
    this.selected = null;
  }

  private renderPanel(): void {
    if (!this.selected) return;
    const { locator, props } = this.selected;

    this.panel.innerHTML = '';
    this.panel.classList.add('on');

    const head = document.createElement('div');
    head.className = 'jd-head';
    const title = document.createElement('span');
    title.className = 'jd-title';
    title.textContent = '元素';
    const close = document.createElement('button');
    close.className = 'jd-btn';
    close.textContent = '关闭';
    close.onclick = () => this.closePanel();
    head.append(title, close);

    const src = document.createElement('div');
    src.className = 'jd-src';
    src.textContent = `${locator.filePath}:${locator.line}:${locator.column}`;

    const body = document.createElement('div');
    body.className = 'jd-body';

    const textNode = this.selected.element.childNodes[0];
    if (textNode && textNode.nodeType === Node.TEXT_NODE && textNode.textContent?.trim()) {
      body.appendChild(this.section('文本'));
      const row = document.createElement('div');
      row.className = 'jd-row';
      const input = document.createElement('textarea');
      input.rows = 2;
      input.value = textNode.textContent;
      input.onchange = () => {
        this.requestChange({ kind: 'text', to: input.value }, `文本 → "${input.value}"`);
      };
      row.appendChild(input);
      body.appendChild(row);
    }

    const lengthProps = props.filter((p) => p.kind === 'length');
    if (lengthProps.length) {
      body.appendChild(this.section('间距'));
      for (const prop of lengthProps) body.appendChild(this.lengthRow(prop));
    }

    const fontSize = props.find((p) => p.kind === 'fontSize');
    if (fontSize) {
      body.appendChild(this.section('文字'));
      body.appendChild(this.selectRow(fontSize, FONT_SIZE_STEPS));
    }

    const colorProps = props.filter((p) => p.kind === 'color');
    if (colorProps.length) {
      body.appendChild(this.section('颜色'));
      for (const prop of colorProps) body.appendChild(this.colorRow(prop));
    }

    const enumProps = props.filter((p) => p.kind === 'enum');
    if (enumProps.length) {
      body.appendChild(this.section('布局'));
      for (const prop of enumProps) body.appendChild(this.selectRow(prop, prop.options ?? []));
    }

    this.panel.append(head, src, body);
  }

  private section(label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jd-sec';
    el.textContent = label;
    return el;
  }

  private lengthRow(prop: EditableProp): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jd-row';
    const label = document.createElement('label');
    label.textContent = prop.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    // 当前值优先从 class 反推（代码是真实来源）；class 推不出时才退回 computed style
    const computed = classToPx(prop.base ?? '') ?? this.computedLength(prop);
    input.value = computed === null ? '' : String(computed);
    input.onchange = () => {
      const toPx = Number(input.value);
      const fromPx = computed;
      if (!Number.isFinite(toPx) || fromPx === null) {
        this.showToast('无法读取当前数值，改用固定类名替换', true);
        return;
      }
      const isRadius = prop.prefix === 'rounded';
      this.requestChange(
        {
          kind: 'classByPx',
          category: isRadius ? 'radius' : 'spacing',
          prefix: prop.prefix!,
          fromPx,
          toPx,
        },
        `${prop.label} ${fromPx}px → ${toPx}px`,
      );
    };
    row.append(label, input);
    return row;
  }

  private selectRow(prop: EditableProp, options: string[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jd-row';
    const label = document.createElement('label');
    label.textContent = prop.label;
    const select = document.createElement('select');
    for (const option of options) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      if (option === prop.base) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => {
      const to = select.value;
      if (prop.key === 'flex-direction') {
        this.requestChange(
          { kind: 'flexDirection', to },
          `排列方向 ${prop.base} → ${to}`,
        );
      } else if (prop.key === 'align-items') {
        this.requestChange({ kind: 'alignItems', to }, `对齐 ${prop.base} → ${to}`);
      } else if (prop.key === 'justify-content') {
        this.requestChange({ kind: 'justifyContent', to }, `分布 ${prop.base} → ${to}`);
      } else if (prop.key === 'font-size') {
        this.requestChange(
          { kind: 'class', category: 'fontSize', fromBase: prop.base!, toBase: to },
          `字号 ${prop.base} → ${to}`,
        );
      }
    };
    row.append(label, select);
    return row;
  }

  private colorRow(prop: EditableProp): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jd-row';
    row.style.flexWrap = 'wrap';
    const label = document.createElement('label');
    label.textContent = prop.label;
    const swatches = document.createElement('div');
    swatches.className = 'jd-sw';
    const candidates = PRESET_COLORS.filter((c) => c.startsWith(prop.key === 'color' ? 'text-' : 'bg-'));
    for (const candidate of candidates) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = candidate;
      button.style.background = CSS_COLOR[candidate] ?? '#cbd5e1';
      if (candidate === prop.base) button.classList.add('on');
      button.onclick = () => {
        this.requestChange(
          { kind: 'class', category: 'color', fromBase: prop.base!, toBase: candidate },
          `${prop.label} ${prop.base} → ${candidate}`,
        );
      };
      swatches.appendChild(button);
    }
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.placeholder = '#rrggbb';
    hex.style.width = '72px';
    hex.onchange = () => {
      const value = hex.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
        this.showToast('请输入 #rrggbb 形式的颜色', true);
        return;
      }
      const arbitrary = `${prop.key === 'color' ? 'text' : 'bg'}-[${value}]`;
      this.requestChange(
        { kind: 'class', category: 'color', fromBase: prop.base!, toBase: arbitrary },
        `${prop.label} → ${value}`,
      );
    };
    row.append(label, swatches, hex);
    return row;
  }

  /** 从 computed style 读当前 px 值（用于 px 语义操作）。 */
  private computedLength(prop: EditableProp): number | null {
    if (!this.selected) return null;
    const style = getComputedStyle(this.selected.element);
    const map: Record<string, string> = {
      'padding-p': 'paddingTop',
      'padding-px': 'paddingLeft',
      'padding-py': 'paddingTop',
      'padding-pt': 'paddingTop',
      'padding-pr': 'paddingRight',
      'padding-pb': 'paddingBottom',
      'padding-pl': 'paddingLeft',
      'margin-m': 'marginTop',
      'margin-mx': 'marginLeft',
      'margin-my': 'marginTop',
      'margin-mt': 'marginTop',
      'margin-mr': 'marginRight',
      'margin-mb': 'marginBottom',
      'margin-ml': 'marginLeft',
      // 注意：gap 是简写属性，Chrome 的 getPropertyValue('gap') 取不到值，
      // 必须用长写属性 rowGap / columnGap
      gap: 'rowGap',
      'border-radius': 'borderTopLeftRadius',
    };
    const propName = map[prop.key];
    if (!propName) return null;
    const raw = style.getPropertyValue(propName);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  /* ---------------- 变更篮 ---------------- */

  private buildBasket(): void {
    this.basket = document.createElement('div');
    this.basket.className = 'jd-basket';

    const head = document.createElement('div');
    head.className = 'jd-bhead';
    this.basketCount = document.createElement('span');
    this.basketCount.className = 'jd-title';
    this.basketCount.textContent = '变更篮 · 0';
    const toggle = document.createElement('button');
    toggle.className = 'jd-btn';
    toggle.textContent = '展开';
    toggle.onclick = () => {
      this.basketOpen = !this.basketOpen;
      this.basketList.style.display = this.basketOpen ? 'block' : 'none';
      toggle.textContent = this.basketOpen ? '收起' : '展开';
    };
    head.append(this.basketCount, toggle);

    this.basketList = document.createElement('div');
    this.basketList.className = 'jd-blist';
    this.basketList.style.display = 'none';

    this.basket.append(head, this.basketList);
    this.root.appendChild(this.basket);
  }

  private renderBasket(): void {
    this.basketCount.textContent = `变更篮 · ${this.changes.length}`;
    this.basket.classList.toggle('on', this.changes.length > 0);
    this.basketList.innerHTML = '';

    if (this.changes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'jd-bempty';
      empty.textContent = '暂无变更';
      this.basketList.appendChild(empty);
      return;
    }

    for (const change of this.changes) {
      const item = document.createElement('div');
      item.className = 'jd-bitem';
      const info = document.createElement('div');
      info.className = 'jd-sum';
      const summary = document.createElement('div');
      summary.textContent = change.summary;
      const file = document.createElement('div');
      file.className = 'jd-file';
      file.textContent = `${change.filePath}:${change.diff.startLine}`;
      info.append(summary, file);

      const undo = document.createElement('button');
      undo.className = 'jd-btn';
      undo.textContent = '撤销';
      undo.onclick = () => this.send({ type: 'undo', payload: { changeId: change.id } });

      item.append(info, undo);
      this.basketList.appendChild(item);
    }
  }

  /* ---------------- 杂项 ---------------- */

  private buildToast(): void {
    this.toast = document.createElement('div');
    this.toast.className = 'jd-toast';
    this.root.appendChild(this.toast);
  }

  private toastTimer?: number;

  private showToast(message: string, isError = false): void {
    this.toast.textContent = message;
    this.toast.classList.toggle('err', isError);
    this.toast.style.display = 'block';
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.style.display = 'none';
    }, isError ? 4200 : 2200);
  }

  private requestChange(op: unknown, summary: string): void {
    if (!this.selected) return;
    this.send({
      type: 'requestChange',
      payload: { locator: this.selected.locator, op: op as never, summary },
    });
  }

  start(): void {
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);
  }
}

const CSS_COLOR: Record<string, string> = {
  'text-slate-900': '#0f172a',
  'text-slate-600': '#475569',
  'text-white': '#ffffff',
  'text-blue-600': '#2563eb',
  'text-emerald-600': '#059669',
  'text-rose-600': '#e11d48',
  'bg-white': '#ffffff',
  'bg-slate-50': '#f8fafc',
  'bg-slate-900': '#0f172a',
  'bg-blue-600': '#2563eb',
  'bg-emerald-600': '#059669',
  'bg-rose-600': '#e11d48',
};

function parseSourceAttr(src: string): ElementLocator {
  const lastColon = src.lastIndexOf(':');
  const secondLast = src.lastIndexOf(':', lastColon - 1);
  return {
    filePath: src.slice(0, secondLast),
    line: Number(src.slice(secondLast + 1, lastColon)),
    column: Number(src.slice(lastColon + 1)),
  };
}

function shortSrc(src: string): string {
  const parts = src.split(':');
  return `${parts[parts.length - 3]}:${parts[parts.length - 2]}`;
}

/* ---------------- 启动 ---------------- */

const port = (globalThis as unknown as { __JIESU_PORT__?: number }).__JIESU_PORT__;
if (port) {
  const overlay = new JiesuOverlay();
  overlay.start();
  overlay.connect(port);
}
