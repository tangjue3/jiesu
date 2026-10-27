import {
  FONT_SIZE_STEPS,
  PRESET_COLORS,
  resolveEditableProps,
  type EditableProp,
} from '../core/inspect/editable-props.js';
import { classToPx } from '../core/inspect/tw-px.js';
import { COMPONENT_TEMPLATES, findTemplate } from '../core/library/components.js';
import type { StructureOp } from '../core/write/structure.js';
import {
  parseTranslate,
  snapPx,
  type Translation,
} from '../core/write/translate.js';
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
import {
  buildLayerTree,
  countEditable,
  keyChainOf,
  type LayerNode,
} from './layers.js';
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
.jd-row label { color: #475569; flex: 1 1 auto; min-width: 0; white-space: nowrap; }
.jd-row.stacked { flex-wrap: wrap; }
.jd-row.actions { gap: 6px; }
.jd-row.actions > label { flex: 0 0 auto; }
.jd-row.stacked > label { flex: 0 0 100%; }
.jd-row input[type=number], .jd-row input[type=text], .jd-row select { width: 104px; padding: 3px 6px; border: 1px solid rgba(0,0,0,.16); border-radius: 4px; font-size: 12px; }
.jd-row textarea { width: 100%; padding: 4px 6px; border: 1px solid rgba(0,0,0,.16); border-radius: 4px; font-size: 12px; resize: vertical; }
.jd-sw { display: flex; gap: 4px; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; justify-content: flex-end; }
.jd-row.actions .jd-sw { flex: 0 0 auto; justify-content: flex-start; }
.jd-sw button.jd-chip { width: 18px; height: 18px; border-radius: 3px; border: 1px solid rgba(0,0,0,.16); cursor: pointer; padding: 0; flex: 0 0 auto; }
.jd-sw button.jd-chip.on { outline: 2px solid #2563eb; outline-offset: 1px; }
.jd-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid rgba(0,0,0,.16); background: #fff; cursor: pointer; font-size: 12px; white-space: nowrap; flex: 0 0 auto; }
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
.jd-hint { position: fixed; left: 12px; top: 12px; max-width: 46vw; background: rgba(17,24,39,.92); color: #fff; padding: 7px 11px; border-radius: 6px; pointer-events: none; display: none; line-height: 1.5; }
.jd-hint.on { display: block; }
.jd-drop { position: fixed; background: #ea580c; border-radius: 2px; pointer-events: none; display: none; box-shadow: 0 0 0 1px rgba(255,255,255,.85); }
.jd-drop.bad { background: #94a3b8; }
.jd-ghost { position: fixed; border: 1.5px dashed #2563eb; background: rgba(37,99,235,.05); border-radius: 4px; pointer-events: none; display: none; }
.jd-move { position: fixed; transform: translateX(-50%); background: #ea580c; color: #fff; padding: 2px 7px; border-radius: 3px; font-size: 11px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; pointer-events: none; display: none; white-space: nowrap; }
.jd-tip { padding: 6px 12px 0; color: #94a3b8; font-size: 11px; line-height: 1.5; }

/* 图层面板（左侧） */
.jd-layers { position: fixed; left: 0; top: 0; bottom: 0; width: 232px; background: rgba(255,255,255,.97); border-right: 1px solid rgba(0,0,0,.12); box-shadow: 2px 0 12px rgba(0,0,0,.05); pointer-events: auto; display: flex; flex-direction: column; }
.jd-layers.off { display: none; }
.jd-lhead { padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,.08); display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.jd-lcount { color: #94a3b8; font-size: 10px; }
.jd-lbody { flex: 1; overflow: auto; padding: 4px 0 12px; }
.jd-lrow { display: flex; align-items: baseline; gap: 4px; padding: 2px 8px 2px 2px; cursor: pointer; white-space: nowrap; border-left: 2px solid transparent; overflow: hidden; }
.jd-lrow:hover { background: rgba(37,99,235,.08); }
.jd-lrow.sel { background: rgba(234,88,12,.12); border-left-color: #ea580c; }
.jd-lrow.nosrc { opacity: .5; }
.jd-care { width: 12px; flex: 0 0 12px; text-align: center; color: #94a3b8; font-size: 9px; }
.jd-ltag { color: #0f172a; font-family: ui-monospace, Menlo, monospace; font-size: 11px; flex: 0 0 auto; }
.jd-lrow.sel .jd-ltag { color: #c2410c; }
.jd-lcls { color: #94a3b8; font-family: ui-monospace, Menlo, monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }
.jd-ltxt { color: #64748b; font-size: 10px; overflow: hidden; text-overflow: ellipsis; flex: 1; }
/* 窄视口（手机画板）：右侧 268px 面板会盖住大半个页面 → 改成底部抽屉 */
@media (max-width: 640px) {
  .jd-panel { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 56vh; border-left: 0; border-top: 1px solid rgba(0,0,0,.12); border-radius: 12px 12px 0 0; }
  .jd-layers { width: min(232px, 74vw); }
  .jd-hint { max-width: 70vw; }
  .jd-basket { max-width: calc(100vw - 24px); }
}
.jd-tab-l { position: fixed; left: 0; top: 50%; transform: translateY(-50%); background: rgba(17,24,39,.9); color: #fff; padding: 9px 4px; border-radius: 0 5px 5px 0; pointer-events: auto; cursor: pointer; writing-mode: vertical-rl; font-size: 11px; display: none; }
.jd-tab-l.on { display: block; }
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

/** 一次进行中的位移：元素真的跟着鼠标走，但落地是 translate 类。 */
interface MoveContext {
  element: HTMLElement;
  start: Point;
  /** 拖拽开始时元素已有的位移（class 里的 translate） */
  base: Translation;
  current: Translation;
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
  private moveLabel!: HTMLDivElement;

  private ws!: WebSocket;
  private selecting = false;
  private selected: Selected | null = null;
  private changes: ChangeRecord[] = [];
  private basketOpen = false;

  /* 拖拽状态：默认拖 = 元素跟着鼠标走（位移）；Shift+拖 = 调整同级顺序（重排） */
  private pendingDrag: { start: Point; shift: boolean } | null = null;
  private drag: DragContext | null = null;
  private dragInsertAt: number | null = null;
  private move: MoveContext | null = null;
  /** 已写回、但内联预览还没清掉的元素（等 HMR 把 class 应用上再清，避免闪回） */
  private pendingMove: { element: HTMLElement; x: number; y: number } | null = null;
  /** 拖拽结束后的那次 click 不应再触发"重新选中" */
  private suppressClick = false;

  /* 图层树状态 */
  private layers!: HTMLDivElement;
  private layerBody!: HTMLDivElement;
  private layerCount!: HTMLSpanElement;
  private layerTab!: HTMLDivElement;
  private layerRoot: LayerNode | null = null;
  private layerExpanded = new Set<string>(['0']);
  /**
   * 默认收起。
   *
   * 理由：这个页面不是我们的画布——面板一展开就会盖住左侧 232px，
   * 用户点不到下面的元素（实测会直接让拖拽失效）。
   * 所以改成"左侧常驻标签 + 主动展开"，需要时再占用空间。
   */
  private layersVisible = false;
  private layersDirty = true;
  private layersInitialized = false;
  private layersTimer: number | null = null;

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
    this.hint.textContent =
      'jiesu：点击元素编辑 · 拖动元素移动 · Shift+拖动调整顺序 · Alt+Shift+L 图层 · Esc 退出';
    rootEl.appendChild(this.hint);

    this.drop = document.createElement('div');
    this.drop.className = 'jd-drop';
    this.ghost = document.createElement('div');
    this.ghost.className = 'jd-ghost';
    this.moveLabel = document.createElement('div');
    this.moveLabel.className = 'jd-move';
    rootEl.append(this.drop, this.ghost, this.moveLabel);

    this.buildPanel();
    this.buildLayers();
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
        // 结构编辑：等 HMR 落地后选中服务端指定的元素（插入 → 新节点，删除 → 父节点）。
        // 不能用旧定位自己去找：同级索引已经重排，旧锚点会指向别的元素。
        if (message.payload.select) {
          this.awaitStructureSelect(
            message.payload.select,
            message.payload.change.filePath,
          );
          break;
        }
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
        // 写回失败 → 把位移预览撤掉，别让元素停在"代码里并不存在"的位置上
        if (this.pendingMove) {
          this.clearMovePreview(this.pendingMove.element);
          this.pendingMove = null;
          if (this.selected) this.paintSelection(this.selected.element);
        }
        // 结构编辑被拒绝 → 必须解锁，否则整个面板就废了
        this.endStructureEdit();
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
    // 拖拽/位移中不要画 hover 高亮：否则会和插入指示线打架，
    // 而且 hover 会把源码标签重新显示出来，压住位移数值气泡
    if (this.drag || this.move || this.pendingDrag) return;
    const target = event.target as HTMLElement | null;
    if (!target || target === this.host) return;
    if (this.host.contains(target)) return;

    this.paintHover(target);
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

    this.selectElement(target);
  };

  /**
   * 选中一个元素（点击画布、点图层树、重绑定都走这里）。
   *
   * 抽成单一入口的原因：图层树和画布必须完全一致地表现"当前选中"，
   * 否则两处状态会各自漂移。
   */
  /**
   * 把当前选中态报告给服务端，Studio 靠它算"插到哪"。
   *
   * 为什么选中态只有一个真源（这里）：Studio 是画布外面的壳，它看不到 iframe 内部，
   * 如果它也自己记一份"当前选中"，两边迟早会漂移——而插入位置错一次就是改错元素。
   */
  private publishSelection(): void {
    if (!this.selected) {
      this.send({ type: 'selection', payload: { selection: null } });
      return;
    }
    const element = this.selected.element;
    // 发送前从活着的 DOM 重读：任何缓存的锚点都可能已经过期
    const locator = parseElementLocator(element) ?? this.selected.locator;
    const tag = element.tagName.toLowerCase();
    const classes = element.className.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    this.send({
      type: 'selection',
      payload: { selection: { locator, tag, label: classes ? `${tag} · ${classes}` : tag } },
    });
  }

  private selectElement(element: HTMLElement): boolean {
    const locator = parseElementLocator(element);
    if (!locator) {
      this.showToast('该元素没有源码位置信息，无法编辑', true);
      return false;
    }

    this.selected = {
      element,
      locator,
      props: resolveEditableProps(element.className.split(/\s+/).filter(Boolean)),
      fingerprint: fingerprintOf(element),
    };

    this.paintSelection(element);
    this.renderPanel();
    this.revealInLayers(element);
    this.publishSelection();
    return true;
  }

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
      if (this.move) {
        this.cancelMove();
        return;
      }
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
      return;
    }
    const isLayers = event.altKey && event.shiftKey && event.key.toLowerCase() === 'l';
    if (isLayers) {
      event.preventDefault();
      this.toggleLayers();
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
    this.pendingDrag = {
      start: { x: event.clientX, y: event.clientY },
      // Shift 在按下的那一刻决定意图，拖到一半再按 Shift 不切换模式（避免误操作）
      shift: event.shiftKey,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const point = { x: event.clientX, y: event.clientY };
    this.lastPointer = point;

    const pending = this.pendingDrag;
    if (pending && !this.drag && !this.move) {
      if (!exceededThreshold(pending.start, point)) return;
      this.pendingDrag = null;
      if (pending.shift) {
        const context = this.buildDragContext();
        if (!context) return;
        this.beginDrag(context);
      } else {
        this.beginMove(pending.start);
      }
    }

    if (this.drag) {
      event.preventDefault();
      this.updateDrag(point);
      return;
    }
    if (this.move) {
      event.preventDefault();
      this.updateMove(point);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.pendingDrag = null;
    if (this.drag) this.finishDrag();
    else if (this.move) this.finishMove();
  };

  /* ---------------- 位移：元素跟着鼠标走 ---------------- */

  /**
   * 拖动开始：记录起始位移，之后每帧用**内联 transform** 做预览。
   *
   * 预览用内联、落地用 class，是刻意的分工：
   *  - 内联 transform 不写文件，拖动过程中 60fps 跟手
   *  - 松手时只把最终值换算成 `translate-x-N` 写进 className
   * 所以代码里永远不会出现坐标，只有语义化的位移类。
   */
  private beginMove(start: Point): void {
    if (!this.selected) return;
    const element = this.selected.element;
    const base = parseTranslate(element.className.split(/\s+/).filter(Boolean));
    this.move = { element, start, base, current: { ...base } };
    document.documentElement.style.userSelect = 'none';
    this.moveLabel.style.display = 'block';
    this.paintMove();
  }

  private updateMove(point: Point): void {
    const move = this.move;
    if (!move) return;
    move.current = {
      x: snapPx(move.base.x + (point.x - move.start.x)),
      y: snapPx(move.base.y + (point.y - move.start.y)),
    };
    this.paintMove();
  }

  /** 把当前位移画到页面上（内联预览 + 数值气泡 + 跟随的选中框）。 */
  private paintMove(): void {
    const move = this.move;
    if (!move) return;
    const { x, y } = move.current;
    const active = x !== 0 || y !== 0;

    // 关键细节：Tailwind v4 的 translate-x-* 写的是 CSS `translate` 属性，
    // v3 写的是 `transform`。内联预览必须**同时**压住这两条路径，否则
    // 后者会和 class 叠加（位移 = class 值 + 内联值，拖一下跳两倍）。
    //   - translate: 0px  → 抵消 v4 class 的贡献
    //   - transform: ...   → 覆盖 v3 class 的 transform，并承载绝对位移
    move.element.style.translate = active ? '0px' : '';
    move.element.style.transform = active ? `translate3d(${x}px, ${y}px, 0)` : '';

    const rect = move.element.getBoundingClientRect();
    const sign = (value: number): string => (value > 0 ? `+${value}` : String(value));
    this.moveLabel.textContent = `X ${sign(x)}  Y ${sign(y)}`;
    this.moveLabel.style.left = `${rect.left + rect.width / 2}px`;
    this.moveLabel.style.top = `${Math.max(0, rect.top - 22)}px`;

    this.paintSelection(move.element);
    // 拖拽时源码标签会被数值气泡压住，让位给更相关的信息
    this.tag.style.display = 'none';
  }

  /** 清掉位移的内联预览（v4 的 translate 与 v3 的 transform 两条路径都要清）。 */
  private clearMovePreview(element: HTMLElement): void {
    element.style.translate = '';
    element.style.transform = '';
  }

  private finishMove(): void {    const move = this.move;
    this.move = null;
    this.moveLabel.style.display = 'none';
    document.documentElement.style.userSelect = '';
    this.suppressClick = true;
    if (!move) return;

    const { x, y } = move.current;
    // 没动（或吸附后回到原点）→ 什么都不做，避免产生无意义 diff
    if (x === move.base.x && y === move.base.y) {
      this.clearMovePreview(move.element);
      if (this.selected) this.paintSelection(this.selected.element);
      return;
    }

    // 内联预览先留着：等 HMR 把 class 应用上再清，否则会闪回原位
    this.pendingMove = { element: move.element, x, y };
    this.requestChange(
      { kind: 'translate', xPx: x, yPx: y },
      `位移 X ${x} Y ${y}`,
    );
  }

  /**
   * HMR 之后清掉内联预览。
   *
   * 必须等 class 真的带上目标位移后再清——否则元素会先跳回原位、
   * 等新 class 生效再跳过去，用户看到的是闪烁。
   */
  private settlePendingMove(): void {
    const pending = this.pendingMove;
    if (!pending) return;
    const now = parseTranslate(pending.element.className.split(/\s+/).filter(Boolean));
    if (now.x !== pending.x || now.y !== pending.y) return;
    this.clearMovePreview(pending.element);
    this.pendingMove = null;
  }

  /** Esc 取消位移：把预览撤掉，代码一个字都不改。 */
  private cancelMove(): void {
    if (!this.move) return;
    this.clearMovePreview(this.move.element);
    this.move = null;
    this.moveLabel.style.display = 'none';
    document.documentElement.style.userSelect = '';
    this.suppressClick = true;
    if (this.selected) this.paintSelection(this.selected.element);
    this.showToast('已取消位移');
  }

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

  /* ---------------- 结构编辑串行化 ----------------
   *
   * 为什么必须串行：插入/删除会**重排同级元素的结构锚点**。
   * 实测（S5）：插入前 <section> 是 0.1，插入后新元素占走 0.1、<section> 变成 0.2。
   * 此时用旧定位去解析新文件，**锚点与行号会一致地指向新插入的元素**，
   * 双锚点交叉校验给出"完全可信"的错误答案。
   *
   * 所以规则是：一次结构编辑发出后，锁住后续编辑，
   * 直到 HMR 落地、新目标被选中、锚点被重新读取，才允许下一次操作。
   */
  private structureBusy = false;
  /** 看门狗：服务端没回消息 / HMR 一直不来时，不能把界面永久锁死 */
  private structureWatchdog: number | null = null;
  /** 等待目标元素出现在 DOM 的轮询 */
  private structurePoll: number | null = null;

  /** 结构编辑进行中时拒绝新的编辑请求，并把原因说清楚。 */
  private blockedByStructure(): boolean {
    if (!this.structureBusy) return false;
    this.showToast('上一次结构改动还在落地，请稍候再改', true);
    return true;
  }

  /**
   * 同步选中态与当前 DOM。
   *
   * HMR 是异步链路（写文件 → vite 编译 → 推模块 → react 重渲染），
   * 立刻去找元素会扑空；等太久又会让面板显示过期数值。
   * 所以采用「轮询等待变化」：检测到 class / 锚点变化或节点被替换才算稳定。
   *
   * 注意：已经在等待时**不要重置计时**。
   * 频繁的 DOM 变动（React 一次提交会改很多属性）会不断重置，
   * 轮询就永远等不到结果——那样面板会一直显示过期的行号。
   */
  private syncSelection(): void {
    if (this.syncTimer !== null) return;
    if (!this.selected) return;

    const baseline = signatureOf(this.selected.element);
    const delays = [60, 120, 250, 400, 700, 1200];
    let attempt = 0;

    const attemptSync = (): void => {
      this.syncTimer = null;
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
    // 节点被替换了 → 图层树里的引用也过期了，重建并重新高亮
    this.layersDirty = true;
    this.renderLayers();
    this.publishSelection();
  }

  /**
   * 刷新选中态的派生数据（class 变了 → 属性列表与当前值要变）。
   *
   * 注意：只更新数值，不重建整个面板——重建会打断用户正在进行的输入。
   */
  private refreshSelectionState(): void {
    if (!this.selected) return;
    // 位移的 class 已经生效了 → 现在才可以清掉内联预览
    this.settlePendingMove();
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
    // 锚点/行号可能变了 → 插到当前位置前，Studio 必须拿到最新的那个
    this.publishSelection();
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
      // 图层树依赖 DOM 结构与 class，所以与"有没有选中"无关，先标记脏
      this.invalidateLayers();

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
    this.observer.observe(target, {
      childList: true,
      subtree: true,
      // class / 锚点变化会让图层标签过时（写回改的就是 class）
      attributes: true,
      attributeFilter: ['class', 'data-jiesu-id'],
    });
  }

  /* ---------------- 图层面板 ---------------- */

  private buildLayers(): void {
    this.layers = document.createElement('div');
    this.layers.className = 'jd-layers';

    const head = document.createElement('div');
    head.className = 'jd-lhead';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '6px';
    const title = document.createElement('span');
    title.className = 'jd-title';
    title.textContent = '图层';
    this.layerCount = document.createElement('span');
    this.layerCount.className = 'jd-lcount';
    left.append(title, this.layerCount);

    const collapse = document.createElement('button');
    collapse.className = 'jd-btn';
    collapse.textContent = '收起';
    collapse.onclick = () => this.setLayersVisible(false);
    head.append(left, collapse);

    this.layerBody = document.createElement('div');
    this.layerBody.className = 'jd-lbody';

    this.layers.append(head, this.layerBody);
    this.root.appendChild(this.layers);

    this.layerTab = document.createElement('div');
    this.layerTab.className = 'jd-tab-l';
    this.layerTab.textContent = '图层';
    this.layerTab.title = '展开图层（Alt+Shift+L）';
    this.layerTab.onclick = () => this.setLayersVisible(true);
    this.root.appendChild(this.layerTab);

    this.setLayersVisible(this.layersVisible);
  }

  private setLayersVisible(visible: boolean): void {
    this.layersVisible = visible;
    this.layers.classList.toggle('off', !visible);
    this.layerTab.classList.toggle('on', !visible);
    if (visible) {
      this.layersDirty = true;
      this.renderLayers();
    }
  }

  private toggleLayers(): void {
    this.setLayersVisible(!this.layersVisible);
  }

  /**
   * 图层树是懒构建 + 脏标记：页面 DOM 被 HMR 改动后才重建。
   * 一次 DOM 全量遍历在真实项目上要几毫秒到几十毫秒，不能每次交互都做。
   */
  private ensureLayerRoot(): LayerNode | null {
    // 客户端脚本注入在 <head>，执行时 body 可能还不存在 → 先不建树
    const body = document.body;
    if (!body) return null;

    if (!this.layerRoot || this.layersDirty) {
      this.layerRoot = buildLayerTree(body);
      this.layersDirty = false;
      if (!this.layersInitialized && this.layerRoot) {
        this.expandTopLevels(this.layerRoot, 0);
        this.layersInitialized = true;
      }
    }
    return this.layerRoot;
  }

  /**
   * 默认展开前几层，让用户一打开就能看到页面主干。
   *
   * 为什么是 3 层：真实页面外面通常套着 `body > #root > App 根节点`，
   * 只展开两层的话用户看到的全是框架外壳，等于没展开。
   */
  private expandTopLevels(node: LayerNode, depth: number): void {
    if (depth >= 3) return;
    if (node.children.length) this.layerExpanded.add(node.key);
    for (const child of node.children) this.expandTopLevels(child, depth + 1);
  }

  private renderLayers(): void {
    if (!this.layersVisible) return;
    const root = this.ensureLayerRoot();
    this.layerBody.innerHTML = '';

    if (!root) {
      this.layerCount.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'jd-bempty';
      empty.textContent = '页面还没有元素';
      this.layerBody.appendChild(empty);
      return;
    }

    this.layerCount.textContent = `${countEditable([root])} 可编辑`;

    const walk = (node: LayerNode, depth: number): void => {
      this.layerBody.appendChild(this.layerRow(node, depth));
      if (!this.layerExpanded.has(node.key)) return;
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(root, 0);
  }

  private layerRow(node: LayerNode, depth: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jd-lrow';
    row.dataset.jdKey = node.key;
    row.style.paddingLeft = `${2 + depth * 10}px`;
    if (!node.anchor) row.classList.add('nosrc');
    if (this.selected?.element === node.element) row.classList.add('sel');
    row.title = node.anchor ? `${node.file}  ·  ${node.anchor}` : '该元素没有源码位置';

    const expanded = this.layerExpanded.has(node.key);
    const caret = document.createElement('span');
    caret.className = 'jd-care';
    caret.textContent = node.children.length ? (expanded ? '▾' : '▸') : '';
    if (node.children.length) {
      caret.onclick = (event) => {
        event.stopPropagation();
        if (expanded) this.layerExpanded.delete(node.key);
        else this.layerExpanded.add(node.key);
        this.renderLayers();
      };
    }

    const tag = document.createElement('span');
    tag.className = 'jd-ltag';
    tag.textContent = node.tag;
    row.append(caret, tag);

    if (node.cls) {
      const cls = document.createElement('span');
      cls.className = 'jd-lcls';
      cls.textContent = `.${node.cls}`;
      row.appendChild(cls);
    }
    if (node.text) {
      const text = document.createElement('span');
      text.className = 'jd-ltxt';
      text.textContent = node.text;
      row.appendChild(text);
    }

    row.onmouseenter = () => this.paintHover(node.element);
    row.onmouseleave = () => this.clearHover();
    row.onclick = () => {
      if (!node.anchor) {
        this.showToast('该元素没有源码位置（多半来自第三方库），无法编辑', true);
        return;
      }
      this.selectElement(node.element);
    };
    return row;
  }

  /** 点图层节点时，把它的祖先链展开并滚动到可见。 */
  private revealInLayers(element: HTMLElement): void {
    if (!this.layersVisible) return;
    const body = document.body;
    if (!body) return;
    const keys = keyChainOf(body, element);
    if (!keys.length) return;
    for (const key of keys) this.layerExpanded.add(key);
    this.renderLayers();

    const ownKey = keys[keys.length - 1];
    const row = Array.from(this.layerBody.querySelectorAll<HTMLElement>('.jd-lrow')).find(
      (item) => item.dataset.jdKey === ownKey,
    );
    row?.scrollIntoView({ block: 'nearest' });
  }

  /** 鼠标悬停在图层节点上时，在页面上画出高亮（不改变选中态）。 */
  private paintHover(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    this.hl.classList.remove('sel');
    this.hl.style.display = 'block';
    this.hl.style.left = `${rect.left}px`;
    this.hl.style.top = `${rect.top}px`;
    this.hl.style.width = `${rect.width}px`;
    this.hl.style.height = `${rect.height}px`;

    const src = element.getAttribute('data-jiesu-src');
    this.tag.classList.remove('sel');
    this.tag.style.display = 'block';
    this.tag.style.left = `${rect.left}px`;
    this.tag.style.top = `${Math.max(0, rect.top - 20)}px`;
    this.tag.textContent = src ? shortSrc(src) : element.tagName.toLowerCase();
  }

  private clearHover(): void {
    if (this.selected) {
      this.paintSelection(this.selected.element);
      return;
    }
    this.hl.style.display = 'none';
    this.tag.style.display = 'none';
  }

  /** DOM 被改动后把图层树标记为脏，并延迟重画（避免一次 HMR 重画多次）。 */
  private invalidateLayers(): void {
    this.layersDirty = true;
    if (!this.layersVisible) return;
    if (this.layersTimer !== null) window.clearTimeout(this.layersTimer);
    this.layersTimer = window.setTimeout(() => {
      this.layersTimer = null;
      this.renderLayers();
    }, 150);
  }

  /* ---------------- 面板 ---------------- */

  private buildPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'jd-panel';
    this.root.appendChild(this.panel);
  }

  private closePanel(): void {
    this.panel.classList.remove('on');
    const had = this.selected !== null;
    this.selected = null;
    if (had) this.publishSelection();
    // 选中态是共享的：面板关掉，图层树里的高亮也要一起清掉
    this.renderLayers();
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
      // 选项必须是完整类名（text-2xl），因为写回层接收的是类名而不是档位
      body.appendChild(
        this.selectRow(
          fontSize,
          FONT_SIZE_STEPS.map((step) => `text-${step}`),
        ),
      );
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

    body.appendChild(this.section('位移'));
    body.appendChild(this.moveRow());

    body.appendChild(this.section('结构'));
    body.appendChild(this.structureActions());
    body.appendChild(this.insertControls());

    const tip = this.dragTip();
    if (tip) body.appendChild(tip);

    this.panel.append(head, src, body);
  }

  /** 位移控件：X / Y 两个数值 + 复位。落地仍然是 translate 类。 */
  private moveRow(): HTMLElement {
    const current = this.currentTranslation();
    const row = document.createElement('div');
    row.className = 'jd-row stacked actions';

    const label = document.createElement('label');
    label.textContent = 'X / Y';

    const controls = document.createElement('div');
    controls.className = 'jd-sw';
    controls.style.alignItems = 'center';

    const makeInput = (axis: 'x' | 'y'): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '4';
      input.style.width = '58px';
      input.value = String(current[axis]);
      input.dataset.jdMove = axis;
      input.title = axis === 'x' ? '水平位移（px）' : '垂直位移（px）';
      input.onchange = () => {
        const live = this.currentTranslation();
        const toPx = snapPx(Number(input.value));
        if (!Number.isFinite(toPx)) {
          this.showToast('请输入数字（会吸附到 4px 刻度）', true);
          return;
        }
        const next = axis === 'x' ? { x: toPx, y: live.y } : { x: live.x, y: toPx };
        this.requestChange(
          { kind: 'translate', xPx: next.x, yPx: next.y },
          `位移 X ${next.x} Y ${next.y}`,
        );
      };
      return input;
    };

    const reset = document.createElement('button');
    reset.className = 'jd-btn';
    reset.textContent = '复位';
    reset.dataset.jdReset = '1';
    reset.disabled = current.x === 0 && current.y === 0;
    reset.onclick = () => {
      this.requestChange({ kind: 'translate', xPx: 0, yPx: 0 }, '位移归零');
    };

    controls.append(makeInput('x'), makeInput('y'), reset);
    row.append(label, controls);
    return row;
  }

  /** 从当前 DOM 的 class 读出位移（代码是唯一真实来源）。 */
  private currentTranslation(): Translation {
    if (!this.selected) return { x: 0, y: 0 };
    return parseTranslate(this.selected.element.className.split(/\s+/).filter(Boolean));
  }

  /* ---------------- 结构操作控件 ---------------- */

  /** 复制 / 删除。两者都会重排同级锚点，所以统一走串行化的 applyStructure。 */
  private structureActions(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'jd-row actions';

    const label = document.createElement('label');
    label.textContent = '本元素';

    const buttons = document.createElement('div');
    buttons.className = 'jd-sw';

    const copy = this.structButton('复制', () => {
      this.applyStructure({ kind: 'duplicate' }, '复制元素');
    });
    const remove = this.structButton('删除', () => {
      this.applyStructure({ kind: 'delete' }, '删除元素');
    });

    buttons.append(copy, remove);
    row.append(label, buttons);
    return row;
  }

  /** 插入组件：选模板 + 选位置。这就是"从组件库拖进来"的第一版形态。 */
  private insertControls(): HTMLElement {
    const wrap = document.createElement('div');

    const pickRow = document.createElement('div');
    pickRow.className = 'jd-row actions';
    const label = document.createElement('label');
    label.textContent = '插入';
    const select = document.createElement('select');
    select.dataset.jdTemplate = '1';
    for (const template of COMPONENT_TEMPLATES) {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = `${template.group} · ${template.name}`;
      select.appendChild(option);
    }
    pickRow.append(label, select);

    const atRow = document.createElement('div');
    atRow.className = 'jd-row actions';
    const spacer = document.createElement('label');
    spacer.textContent = '';
    const buttons = document.createElement('div');
    buttons.className = 'jd-sw';

    const insert = (position: 'before' | 'after' | 'last') => {
      const template = findTemplate(select.value);
      if (!template) {
        this.showToast('请选择一个组件模板', true);
        return;
      }
      const op: StructureOp =
        position === 'last'
          ? { kind: 'insertChild', position: 'last', snippet: template.snippet }
          : { kind: 'insert', position, snippet: template.snippet };
      const where = position === 'before' ? '上方' : position === 'after' ? '下方' : '内部';
      this.applyStructure(op, `插入 ${template.name}（${where}）`);
    };

    buttons.append(
      this.structButton('上方', () => insert('before')),
      this.structButton('下方', () => insert('after')),
      this.structButton('内部', () => insert('last')),
    );

    atRow.append(spacer, buttons);
    wrap.append(pickRow, atRow);
    return wrap;
  }

  private structButton(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'jd-btn';
    button.textContent = text;
    button.dataset.jdStruct = '1';
    button.disabled = this.structureBusy;
    button.onclick = onClick;
    return button;
  }

  /** 拖拽是隐式交互，不说明没人会试；顺便说明两种拖法的区别。 */
  private dragTip(): HTMLElement | null {
    if (!this.selected) return null;
    const container = this.selected.element.parentElement;
    const canReorder = container
      ? Boolean(dragModeFromDisplay(getComputedStyle(container).display, getComputedStyle(container).flexDirection))
      : false;

    const tip = document.createElement('div');
    tip.className = 'jd-tip';
    tip.textContent = canReorder
      ? '拖动元素 = 跟着鼠标移动（写 translate 类，不写坐标）· Shift+拖动 = 调整同级顺序'
      : '拖动元素 = 跟着鼠标移动（写 translate 类，不写坐标）';
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

    // 行号会漂移，面板上显示的必须是刚读到的那个
    const srcEl = this.panel.querySelector('.jd-src');
    if (srcEl) {
      const { filePath, line, column } = this.selected.locator;
      srcEl.textContent = `${filePath}:${line}:${column}`;
    }

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

    // 位移输入框：HMR 之后 class 里的 translate 已经变了，要跟着回填
    const moveInputs = Array.from(
      this.panel.querySelectorAll<HTMLInputElement>('input[data-jd-move]'),
    );
    if (moveInputs.length) {
      const now = this.currentTranslation();
      for (const input of moveInputs) {
        const axis = input.dataset.jdMove === 'y' ? 'y' : 'x';
        const next = String(now[axis]);
        if (document.activeElement !== input && input.value !== next) input.value = next;
      }
      // 复位按钮的可用状态也得跟着变，否则拖完之后它还是灰的，点不动
      const reset = this.panel.querySelector<HTMLButtonElement>('button[data-jd-reset]');
      if (reset) reset.disabled = now.x === 0 && now.y === 0;
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
      // 行标题已经说明是"字号"，下拉里只显示档位（2xl）更好读
      opt.textContent = option.startsWith('text-') ? option.slice(5) : option;
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
      button.className = 'jd-chip';
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
    if (this.blockedByStructure()) return;
    // 发送前从**活着的 DOM 元素**上重读锚点：
    // 写回与 HMR 之间隔了几十到几百毫秒，任何缓存的行号都可能已经过期，
    // 而"改错元素"是这个产品最不能犯的错。
    const fresh = parseElementLocator(this.selected.element);
    if (fresh && !locator) this.selected.locator = fresh;
    this.send({
      type: 'requestChange',
      payload: { locator: locator ?? fresh ?? this.selected.locator, op: op as never, summary },
    });
  }

  /* ---------------- 结构编辑（插入 / 删除 / 复制） ---------------- */

  /**
   * 发出一次结构编辑。
   *
   * 与 requestChange 分开：它改变同级元素的锚点，所以发出去就上锁，
   * 下一次编辑必须等新目标被选中、锚点重读之后。
   */
  private applyStructure(op: StructureOp, summary: string): void {
    if (!this.selected) return;
    if (this.blockedByStructure()) return;

    const fresh = parseElementLocator(this.selected.element);
    if (fresh) this.selected.locator = fresh;
    const locator = fresh ?? this.selected.locator;

    this.structureBusy = true;
    this.refreshStructureUi();
    this.armStructureWatchdog();
    this.send({ type: 'requestStructure', payload: { locator, op, summary } });
  }

  /**
   * 结构编辑后接管"接下来该选中谁"。
   *
   * 这里有两个必须同时满足的门槛，缺一个就会选错元素：
   *
   *  ① **等 HMR 真的重建了 DOM**（一次结构性变动）。
   *     插入会让同级索引整体后移：新节点占走 0.0.2.1，原来的"第二块"被挤到 0.0.2.2。
   *     而在这之前，DOM 上的 0.0.2.1 还是"第二块"——按锚点直接查会立刻命中**旧元素**，
   *     于是锁定被提前解开，用户接着的编辑就打在别人身上。
   *     （这不是理论：v05 端到端第一次就是栽在这里。）
   *
   *  ② **锚点 + 源码行列双匹配**。服务端知道新节点在新文件里的确切位置，
   *     两者都吻合才算找到了它；只有锚点吻合说明 DOM 还是旧的。
   */
  private awaitStructureSelect(
    select: { anchor: string; line: number; column: number },
    filePath: string,
  ): void {
    const targetId = `${filePath}#${select.anchor}`;
    const expectSrc = select.line > 0 ? `${filePath}:${select.line}:${select.column}` : null;
    const previous = this.selected?.element;
    const previousRect = previous?.isConnected ? previous.getBoundingClientRect() : null;

    const delays = [40, 80, 120, 200, 320, 500, 800];
    let attempt = 0;

    const tryFind = (): void => {
      this.structurePoll = null;

      const byId = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-jiesu-id="${escapeAttrValue(targetId)}"]`),
      );
      const matches = expectSrc
        ? byId.filter((element) => element.getAttribute('data-jiesu-src') === expectSrc)
        : byId;

      if (matches.length > 0) {
        this.selectElement(pickNearest(matches, previousRect));
        this.endStructureEdit();
        return;
      }

      if (attempt < delays.length) {
        this.structurePoll = window.setTimeout(tryFind, delays[attempt]);
        attempt += 1;
        return;
      }

      // 明确失败，而不是留一个指向旧位置（很可能已被别的元素占用）的选中态
      this.endStructureEdit();
      this.showToast(
        '结构改动已写入代码，但页面还没更新到位（可能被条件渲染挡住），请重新选择',
        true,
      );
    };

    // 先等一次结构性变动（React 重渲染会重建节点），再开始按位置找
    this.waitForStructuralMutation(5000).then((mutated) => {
      if (!this.structureBusy) return;
      if (!mutated) {
        // 没有任何结构变动：可能改动没生效，也可能这次编辑不影响 DOM
        tryFind();
        return;
      }
      this.structurePoll = window.setTimeout(tryFind, delays[0]);
    });
  }

  /** 等到一次 childList 变动（= React 重建了节点）；超时返回 false。 */
  private waitForStructuralMutation(timeoutMs: number): Promise<boolean> {
    if (typeof MutationObserver === 'undefined') return Promise.resolve(true);
    const target = document.body ?? document.documentElement;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const observer = new MutationObserver((records) => {
        const structural = records.some(
          (record) => record.addedNodes.length > 0 || record.removedNodes.length > 0,
        );
        if (!structural || done) return;
        done = true;
        observer.disconnect();
        resolve(true);
      });
      observer.observe(target, { childList: true, subtree: true });
      window.setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  }

  private armStructureWatchdog(): void {
    if (this.structureWatchdog !== null) window.clearTimeout(this.structureWatchdog);
    this.structureWatchdog = window.setTimeout(() => {
      this.structureWatchdog = null;
      if (!this.structureBusy) return;
      this.endStructureEdit();
      this.showToast('结构编辑超时未确认，已解锁', true);
    }, 8000);
  }

  private endStructureEdit(): void {
    this.structureBusy = false;
    if (this.structureWatchdog !== null) {
      window.clearTimeout(this.structureWatchdog);
      this.structureWatchdog = null;
    }
    if (this.structurePoll !== null) {
      window.clearTimeout(this.structurePoll);
      this.structurePoll = null;
    }
    this.refreshStructureUi();
  }

  /** 结构按钮在锁住期间要禁用——不然用户会一直点、一直收到同一条拒绝提示。 */
  private refreshStructureUi(): void {
    const buttons = this.panel?.querySelectorAll<HTMLButtonElement>('[data-jd-struct]') ?? [];
    for (const button of buttons) button.disabled = this.structureBusy;
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
      if (this.drag || this.move) event.preventDefault();
    });
    // 视口变化（切设备、拉窗口）后选中框与标签会停在旧坐标上 → 重画一次
    window.addEventListener('resize', () => {
      if (this.selected) this.paintSelection(this.selected.element);
    });
    this.ensureObserver();
    // 脚本在 <head> 执行时 body 尚不存在，等 DOM 就绪再画第一次
    if (document.body) {
      this.renderLayers();
    } else {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          this.layersDirty = true;
          this.renderLayers();
        },
        { once: true },
      );
    }
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

/** 属性选择器里的值转义（路径可能含引号/反斜杠）。 */
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 同一个源码元素可能在页面上有多个实例（列表渲染）。
 * 结构编辑后优先选**离原选中位置最近**的那个，用户才不会觉得"跳走了"。
 */
function pickNearest(elements: HTMLElement[], previous: DOMRect | null): HTMLElement {
  if (elements.length === 1 || !previous) return elements[0];
  const cx = previous.left + previous.width / 2;
  const cy = previous.top + previous.height / 2;
  let best = elements[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - cx;
    const dy = rect.top + rect.height / 2 - cy;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = element;
    }
  }
  return best;
}

/* ---------------- 启动 ---------------- */

const port = (globalThis as unknown as { __JIESU_PORT__?: number }).__JIESU_PORT__;
if (port) {
  const overlay = new JiesuOverlay();
  overlay.start();
  overlay.connect(port);
}
