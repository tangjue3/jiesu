import {
  FONT_SIZE_STEPS,
  PRESET_COLORS,
  resolveEditableProps,
  type EditableProp,
} from '../core/inspect/editable-props.js';
import { classToPx } from '../core/inspect/tw-px.js';
import type { ChangeRecord, ClientMessage, ElementLocator, ServerMessage } from '../server/protocol.js';
import {
  dragModeFromDisplay,
  exceededThreshold,
  gridIndicator,
  insertionIndexGrid,
  insertionIndexLinear,
  isOutside,
  linearIndicator,
  planReorder,
  type DragMode,
  type Point,
  type Rect,
} from './drag.js';
import { findByFingerprint, fingerprintOf, type ElementFingerprint } from './fingerprint.js';

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
.jd-row label { color: #475569; flex: 1; white-space: nowrap; }
.jd-row.stacked { flex-wrap: wrap; }
.jd-row.stacked > label { flex: 0 0 100%; }
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
.jd-hint { position: fixed; left: 50%; transform: translateX(-50%); top: 12px; background: rgba(17,24,39,.92); color: #fff; padding: 7px 11px; border-radius: 6px; pointer-events: none; display: none; }
.jd-hint.on { display: block; }
.jd-drop { position: fixed; background: #ea580c; border-radius: 2px; pointer-events: none; display: none; box-shadow: 0 0 0 1px rgba(255,255,255,.85); }
.jd-drop.bad { background: #94a3b8; }
.jd-ghost { position: fixed; border: 1.5px dashed #2563eb; background: rgba(37,99,235,.05); border-radius: 4px; pointer-events: none; display: none; }
.jd-tip { padding: 6px 12px 0; color: #94a3b8; font-size: 11px; line-height: 1.5; }
`;

interface Selected {
  element: HTMLElement;
  locator: ElementLocator;
  props: EditableProp[];
  /** 指纹：HMR 重渲染后据此找回同一个元素 */
  fingerprint: ElementFingerprint;
}

/** 一次进行中的拖拽：拖的是"已选中元素在父容器里的位置"。 */
interface DragContext {
  container: HTMLElement;
  /** 父容器的定位（childOrder 作用在容器上，不是被拖的子项） */
  locator: ElementLocator;
  items: HTMLElement[];
  rects: Rect[];
  containerRect: Rect;
  mode: DragMode;
  from: number;
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
  private drop!: HTMLDivElement;
  private ghost!: HTMLDivElement;

  private ws!: WebSocket;
  private selecting = false;
  private selected: Selected | null = null;
  private changes: ChangeRecord[] = [];
  private basketOpen = false;

  /* 拖拽重排状态 */
  private pendingDrag: Point | null = null;
  private drag: DragContext | null = null;
  private dragInsertAt: number | null = null;
  /** 拖拽结束后的那次 click 不应再触发"重新选中" */
  private suppressClick = false;

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
    this.hint.textContent = 'jiesu：点击元素进行编辑 · 拖动已选元素可调整同级顺序 · Esc 退出';
    rootEl.appendChild(this.hint);

    this.drop = document.createElement('div');
    this.drop.className = 'jd-drop';
    this.ghost = document.createElement('div');
    this.ghost.className = 'jd-ghost';
    rootEl.append(this.drop, this.ghost);

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
        // 写回会触发 HMR → DOM 重建。等 Vite 推送新模块后重新绑定选中态。
        // 只有"本次操作的目标就是选中元素"时才采用服务端回传的锚点：
        // 拖拽重排的目标是父容器，被拖子项的锚点会随位置变化，
        // 那种情况必须等 HMR 后从 DOM 重新读，不能被容器的锚点覆盖。
        if (
          this.selected &&
          message.payload.change.locator?.anchor === this.selected.locator.anchor
        ) {
          this.selected.locator = {
            ...this.selected.locator,
            anchor: message.payload.anchor ?? this.selected.locator.anchor,
          };
        }
        this.syncSelection();
        break;      case 'changeUndone':
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
    // 拖拽中不要画 hover 高亮，否则会和插入指示线打架
    if (this.drag || this.pendingDrag) return;
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
    if (this.suppressClick) {
      // 刚刚结束一次拖拽：这次 click 是拖拽的副产物，不能当成"选中另一个元素"
      this.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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

    const locator = parseElementLocator(target);
    if (!locator) {
      this.showToast('该元素没有源码位置信息，无法编辑', true);
      return;
    }
    const props = resolveEditableProps(target.className.split(/\s+/).filter(Boolean));
    this.selected = {
      element: target,
      locator,
      props,
      fingerprint: fingerprintOf(target),
    };

    this.paintSelection(target);
    this.renderPanel();
  };

  /** 绘制选中高亮框与标签。 */
  private paintSelection(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
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
    const src = element.getAttribute('data-jiesu-src');
    this.tag.textContent = src ? shortSrc(src) : `${element.tagName.toLowerCase()}（无法定位源码）`;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (this.drag) {
        this.cancelDrag();
        return;
      }
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

  /* ---------------- 拖拽重排（布局语义，不产生绝对定位） ---------------- */

  /**
   * 拖拽的语义边界（刻意收窄）：
   *  - 只调整**同一个父容器内**同级元素的顺序
   *  - 落地方式是移动 JSX 节点，绝不写 position / left / top
   *  - 父容器不是 flex/grid、或 DOM 子项数与源码子项数不一致 → 明确拒绝
   */
  private buildDragContext(): DragContext | null {
    if (!this.selected) return null;
    const container = this.selected.element.parentElement;
    if (!container) {
      this.showToast('该元素没有父容器，无法调整顺序', true);
      return null;
    }

    const style = getComputedStyle(container);
    const mode = dragModeFromDisplay(style.display, style.flexDirection);
    if (!mode) {
      this.showToast(
        `父容器不是 flex/grid 布局（display: ${style.display}），暂不支持拖拽重排`,
        true,
      );
      return null;
    }

    const locator = parseElementLocator(container);
    if (!locator?.anchor) {
      this.showToast('父容器没有源码锚点，无法安全重排', true);
      return null;
    }

    const items = Array.from(container.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const from = items.indexOf(this.selected.element);
    if (from < 0 || items.length < 2) {
      this.showToast('该容器里没有可重排的同级元素', true);
      return null;
    }

    return {
      container,
      locator,
      items,
      rects: items.map((item) => toRect(item.getBoundingClientRect())),
      containerRect: toRect(container.getBoundingClientRect()),
      mode,
      from,
    };
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (!this.selected) return;
    const target = event.target as HTMLElement | null;
    if (!target || target === this.host || this.host.contains(target)) return;
    // 只有"按在已选中元素内部"才可能是拖拽；点别处仍然是常规选中
    if (!this.selected.element.contains(target)) return;
    this.pendingDrag = { x: event.clientX, y: event.clientY };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = { x: event.clientX, y: event.clientY };
    this.lastPointer = point;

    if (this.pendingDrag && !this.drag) {
      if (!exceededThreshold(this.pendingDrag, point)) return;
      const context = this.buildDragContext();
      this.pendingDrag = null;
      if (!context) return;
      this.beginDrag(context);
    }

    if (!this.drag) return;
    event.preventDefault();
    this.updateDrag(point);
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.pendingDrag = null;
    if (this.drag) this.finishDrag();
  };

  private beginDrag(context: DragContext): void {
    this.drag = context;
    this.dragInsertAt = context.from;
    this.hl.style.display = 'none';
    this.tag.style.display = 'none';

    const rect = context.rects[context.from];
    this.paintBox(this.ghost, rect);
    this.ghost.style.display = 'block';

    // 拖拽期间禁止选中文本：否则会拖出一片蓝色选区，体验很差
    document.documentElement.style.userSelect = 'none';
  }

  /** 计算插入位置并画出指示线。 */
  private updateDrag(point: Point): void {
    if (!this.drag) return;
    const { rects, mode, containerRect } = this.drag;

    const insertAt =
      mode.kind === 'linear'
        ? insertionIndexLinear(rects, mode.axis, point)
        : insertionIndexGrid(rects, point);
    this.dragInsertAt = insertAt;

    const outside = isOutside(containerRect, point);
    const indicator =
      mode.kind === 'linear'
        ? linearIndicator(rects, mode.axis, insertAt)
        : gridIndicator(rects, insertAt);

    if (!indicator) return;
    this.paintBox(this.drop, indicator);
    this.drop.classList.toggle('bad', outside);
    this.drop.style.display = 'block';
  }

  /**
   * 松手：把"松手位置"翻译成一次结构级重排。
   *
   * 注意 locator 用的是**父容器**——childOrder 作用在容器上，
   * 被拖的子项只是顺序变了，自身并不需要改写。
   */
  private finishDrag(): void {
    const context = this.drag;
    const insertAt = this.dragInsertAt;
    const point = this.lastPointer;
    this.teardownDrag();
    // 拖拽结束后浏览器还会派发一次 click，这次不能被当成"选中另一个元素"
    this.suppressClick = true;

    if (!context || insertAt === null) return;

    if (point && isOutside(context.containerRect, point)) {
      this.showToast('跨容器拖拽暂不支持，已取消这次调整', true);
      return;
    }

    const plan = planReorder(context.items.length, context.from, insertAt);
    if (!plan) {
      this.showToast('无法确定目标位置，已取消', true);
      return;
    }
    if (plan.noop) return;

    const to = insertAt > context.from ? insertAt : insertAt + 1;
    this.requestChange(
      { kind: 'childOrder', to: plan.order, expectItems: context.items.length },
      `调整顺序：第 ${context.from + 1} 项 → 第 ${to} 位`,
      context.locator,
    );
  }

  private cancelDrag(): void {
    this.teardownDrag();
    this.showToast('已取消拖拽');
  }

  private teardownDrag(): void {
    this.drag = null;
    this.dragInsertAt = null;
    this.drop.style.display = 'none';
    this.drop.classList.remove('bad');
    this.ghost.style.display = 'none';
    document.documentElement.style.userSelect = '';
    if (this.selected) this.paintSelection(this.selected.element);
  }

  /** 记录最后一次指针位置（松手时判断是否拖到了容器外）。 */
  private lastPointer: Point | null = null;

  private paintBox(element: HTMLElement, rect: Rect): void {
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }

  /* ---------------- HMR 后重新绑定选中态 ---------------- */

  /**
   * 写回代码 → Vite HMR → React 重渲染。此时：
   *  - DOM 节点可能被替换（React 重建了它），也可能被复用但 class 变了
   *  - 元素在源码里的行号也漂移了
   *
   * 所以写回后不能直接用旧的 element 引用，必须等 DOM 稳定后重新同步。
   */
  private syncTimer: number | null = null;

  /**
   * 同步选中态与当前 DOM。
   *
   * HMR 是异步链路（写文件 → vite 编译 → 推模块 → react 重渲染），
   * 立刻去找元素会扑空；等太久又会让面板显示过期数值。
   * 所以采用「轮询等待变化」：检测到 class 变化或节点被替换才算稳定。
   */
  private syncSelection(): void {
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (!this.selected) return;

    const baseline = signatureOf(this.selected.element);
    const delays = [60, 120, 250, 400, 700, 1200];
    let attempt = 0;

    const attemptSync = (): void => {
      if (!this.selected) return;
      const element = this.selected.element;

      // 情况 A：节点被替换 → 用指纹找回同一个元素
      if (!element.isConnected) {
        const match = findByFingerprint(document, this.selected.fingerprint);
        if (match) {
          this.adoptElement(match.element);
          return;
        }
        if (attempt < delays.length) {
          this.syncTimer = window.setTimeout(attemptSync, delays[attempt]);
          attempt += 1;
          return;
        }
        // 反复找不到 → 明确告知，而不是留一个指向死节点的选中态
        this.closePanel();
        this.showToast('该元素已不存在（代码可能已被重构），请重新选择', true);
        return;
      }

      // 情况 B：节点还在但状态变了 → 内容已更新，刷新
      // 为什么要看注入属性：拖拽重排后 class 没变，变的是锚点与行号，
      // 只比 className 会以为"还没变化"，白等到超时才刷新。
      if (signatureOf(element) !== baseline) {
        this.refreshSelectionState();
        return;
      }

      // 情况 C：还没变化 → 继续等
      if (attempt < delays.length) {
        this.syncTimer = window.setTimeout(attemptSync, delays[attempt]);
        attempt += 1;
        return;
      }

      // 超时：这次 HMR 没影响该元素（或改的是文本）→ 仍然同步一次
      this.refreshSelectionState();
    };

    this.syncTimer = window.setTimeout(attemptSync, delays[0]);
  }

  /** 接管一个新找到的元素（节点被替换后）。 */
  private adoptElement(element: HTMLElement): void {
    if (!this.selected) return;
    const locator = parseElementLocator(element);
    this.selected = {
      element,
      locator: locator ?? this.selected.locator,
      props: resolveEditableProps(element.className.split(/\s+/).filter(Boolean)),
      fingerprint: fingerprintOf(element),
    };
    this.paintSelection(element);
    this.renderPanel();
  }

  /**
   * 刷新选中态的派生数据（class 变了 → 属性列表与当前值要变）。
   *
   * 注意：只更新数值，不重建整个面板——重建会打断用户正在进行的输入。
   */
  private refreshSelectionState(): void {
    if (!this.selected) return;
    const element = this.selected.element;
    const locator = parseElementLocator(element);
    this.selected = {
      element,
      locator: locator ?? this.selected.locator,
      props: resolveEditableProps(element.className.split(/\s+/).filter(Boolean)),
      fingerprint: fingerprintOf(element),
    };
    this.paintSelection(element);
    this.updatePanelValues();
  }

  /**
   * MutationObserver：捕获用户手动改代码触发的 HMR。
   * 写回触发的 HMR 由 syncSelection 主动处理，这里只作兜底。
   */
  private observer: MutationObserver | null = null;
  private observerScheduled = false;

  private ensureObserver(): void {
    if (this.observer || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => {
      if (!this.selected || this.observerScheduled) return;
      this.observerScheduled = true;
      // 让 React 先把新 DOM 挂上去，再同步
      setTimeout(() => {
        this.observerScheduled = false;
        this.syncSelection();
      }, 0);
    });
    // 脚本注入在 <head>，此时 body 可能还不存在 → 等 DOM 就绪再观察
    const target = document.body ?? document.documentElement;
    this.observer.observe(target, { childList: true, subtree: true });
  }

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
    const spacingProps = lengthProps.filter((p) => p.prefix !== 'rounded');
    const radiusProps = lengthProps.filter((p) => p.prefix === 'rounded');
    if (spacingProps.length) {
      body.appendChild(this.section('间距'));
      for (const prop of spacingProps) body.appendChild(this.lengthRow(prop));
    }
    if (radiusProps.length) {
      body.appendChild(this.section('圆角'));
      for (const prop of radiusProps) body.appendChild(this.lengthRow(prop));
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

    const tip = this.dragTip();
    if (tip) body.appendChild(tip);

    this.panel.append(head, src, body);
  }

  /** 可拖拽时给一句提示——拖拽是隐式交互，不说明没人会试。 */
  private dragTip(): HTMLElement | null {
    if (!this.selected) return null;
    const container = this.selected.element.parentElement;
    if (!container) return null;
    const style = getComputedStyle(container);
    if (!dragModeFromDisplay(style.display, style.flexDirection)) return null;
    const tip = document.createElement('div');
    tip.className = 'jd-tip';
    tip.textContent = '拖动当前元素，可调整它在同级中的顺序（只改代码里的节点顺序）';
    return tip;
  }

  private section(label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'jd-sec';
    el.textContent = label;
    return el;
  }

  /**
   * HMR 之后刷新面板上的数值。
   *
   * 只改数值，不重建面板 DOM——重建会清空用户正在输入的内容。
   * 找不到对应行（属性本身变了）才重建。
   */
  private updatePanelValues(): void {
    if (!this.selected) return;
    const props = this.selected.props;

    const numberInputs = Array.from(
      this.panel.querySelectorAll<HTMLInputElement>('.jd-row input[type=number]'),
    );
    for (const input of numberInputs) {
      const key = input.dataset.jdProp;
      if (!key) continue;
      const prop = props.find((p) => p.key === key);
      if (!prop) continue;
      const px = classToPx(prop.base ?? '') ?? this.computedLength(prop);
      const next = px === null ? '' : String(px);
      // 用户正在编辑这个输入框 → 不覆盖
      if (document.activeElement !== input && input.value !== next) {
        input.value = next;
      }
    }

    const selects = Array.from(this.panel.querySelectorAll<HTMLSelectElement>('.jd-row select'));
    for (const select of selects) {
      const key = select.dataset.jdProp;
      if (!key) continue;
      const prop = props.find((p) => p.key === key);
      if (!prop?.base) continue;
      if (select.value !== prop.base && document.activeElement !== select) {
        select.value = prop.base;
      }
    }
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
    // 标记：HMR 刷新时按属性标识回填数值
    input.dataset.jdProp = prop.key;
    input.onchange = () => {
      const toPx = Number(input.value);
      // 当前值必须在**提交这一刻**从代码里读，不能用渲染时捕获的值：
      // HMR 之后代码里的类名已经变了，用旧值会算错 fromPx。
      const fromPx = this.currentPxOf(prop.key);
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

  /**
   * 读取某个属性在**当前代码**里的 px 值。
   *
   * 从 DOM 的 class 反推（代码是唯一真实来源），而不是用面板缓存的旧值——
   * 否则 HMR 之后会拿着过期的 fromPx 去改写，导致匹配失败。
   */
  private currentPxOf(propKey: string): number | null {
    if (!this.selected) return null;
    const prop = this.selected.props.find((p) => p.key === propKey);
    if (!prop) return null;
    const tokens = this.selected.element.className.split(/\s+/).filter(Boolean);
    const live = resolveEditableProps(tokens).find((p) => p.key === propKey);
    const base = live?.base ?? prop.base;
    return classToPx(base ?? '') ?? this.computedLength(prop);
  }

  private selectRow(prop: EditableProp, options: string[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jd-row';
    const label = document.createElement('label');
    label.textContent = prop.label;
    const select = document.createElement('select');
    select.dataset.jdProp = prop.key;
    for (const option of options) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      if (option === prop.base) opt.selected = true;
      select.appendChild(opt);
    }
    select.onchange = () => {
      const to = select.value;
      // 当前基础类名从**当前代码**读，不用渲染时捕获的值（HMR 后可能已变）
      const from = this.currentBaseOf(prop.key) ?? prop.base;
      if (prop.key === 'flex-direction') {
        this.requestChange({ kind: 'flexDirection', to }, `排列方向 ${from} → ${to}`);
      } else if (prop.key === 'align-items') {
        this.requestChange({ kind: 'alignItems', to }, `对齐 ${from} → ${to}`);
      } else if (prop.key === 'justify-content') {
        this.requestChange({ kind: 'justifyContent', to }, `分布 ${from} → ${to}`);
      } else if (prop.key === 'font-size') {
        this.requestChange(
          { kind: 'class', category: 'fontSize', fromBase: from!, toBase: to },
          `字号 ${from} → ${to}`,
        );
      }
    };
    row.append(label, select);
    return row;
  }

  /** 读取某个属性在**当前代码**里的基础类名。 */
  private currentBaseOf(propKey: string): string | undefined {
    if (!this.selected) return undefined;
    const tokens = this.selected.element.className.split(/\s+/).filter(Boolean);
    const live = resolveEditableProps(tokens).find((p) => p.key === propKey);
    return live?.base ?? this.selected.props.find((p) => p.key === propKey)?.base;
  }

  private colorRow(prop: EditableProp): HTMLElement {
    const row = document.createElement('div');
    // 色板 + 十六进制输入占宽度较大，标签独占一行，避免被挤成竖排
    row.className = 'jd-row stacked';
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
        const from = this.currentBaseOf(prop.key) ?? prop.base;
        this.requestChange(
          { kind: 'class', category: 'color', fromBase: from!, toBase: candidate },
          `${prop.label} ${from} → ${candidate}`,
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
      const from = this.currentBaseOf(prop.key) ?? prop.base;
      this.requestChange(
        { kind: 'class', category: 'color', fromBase: from!, toBase: arbitrary },
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

  private requestChange(op: unknown, summary: string, locator?: ElementLocator): void {
    if (!this.selected) return;
    this.send({
      type: 'requestChange',
      payload: { locator: locator ?? this.selected.locator, op: op as never, summary },
    });
  }

  start(): void {
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('pointermove', this.onPointerMove, true);
    document.addEventListener('pointerup', this.onPointerUp, true);
    document.addEventListener('pointercancel', this.onPointerUp, true);
    // 阻止浏览器原生的拖拽（拖图片/链接会走 HTML5 DnD，和我们的拖拽冲突）
    document.addEventListener('dragstart', (event) => {
      if (this.drag) event.preventDefault();
    });
    this.ensureObserver();
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

/**
 * 从 DOM 属性解析定位信息。
 *
 * 优先读 data-jiesu-id（形如 `src/App.tsx#0.1`）——它同时包含文件路径、
 * 行号列号与结构锚点，信息最全；读不到再退回 data-jiesu-src。
 */
function parseElementLocator(element: HTMLElement): ElementLocator | null {
  const id = element.getAttribute('data-jiesu-id');
  if (id) {
    const hashIndex = id.lastIndexOf('#');
    if (hashIndex > 0) {
      const filePath = id.slice(0, hashIndex);
      const anchor = id.slice(hashIndex + 1);
      // id 里不含行列，行列仍从 data-jiesu-src 取
      const src = element.getAttribute('data-jiesu-src');
      const base = src ? parseSourceAttr(src) : null;
      if (base) {
        return { ...base, filePath, anchor };
      }
      return { filePath, line: 0, column: 0, anchor };
    }
  }
  const src = element.getAttribute('data-jiesu-src');
  return src ? parseSourceAttr(src) : null;
}

function shortSrc(src: string): string {
  const parts = src.split(':');
  return `${parts[parts.length - 3]}:${parts[parts.length - 2]}`;
}

/** DOMRect → 纯数据矩形（覆盖层用 position:fixed，视口坐标可直接用）。 */
function toRect(rect: DOMRect): Rect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * 元素"状态签名"：class + 注入的位置属性。
 *
 * 用途：写完代码后判断这个元素是否已经跟着 HMR 更新了。
 * 只看 className 会漏掉"顺序变了、class 没变"的情况（拖拽重排就是）。
 */
function signatureOf(element: HTMLElement): string {
  return [
    element.className,
    element.getAttribute('data-jiesu-src') ?? '',
    element.getAttribute('data-jiesu-id') ?? '',
  ].join('|');
}

/* ---------------- 启动 ---------------- */

const port = (globalThis as unknown as { __JIESU_PORT__?: number }).__JIESU_PORT__;
if (port) {
  const overlay = new JiesuOverlay();
  overlay.start();
  overlay.connect(port);
}
