import type { FileDiff } from '../core/write/apply.js';
import type { LayoutOp } from '../core/layout/apply-layout.js';
import type { StyleOp } from '../core/write/apply.js';
import type { StructureOp } from '../core/write/structure.js';

/** 元素在源码中的位置（与编译期注入的 data-jiesu-src 对应）。 */
export interface ElementLocator {
  filePath: string;
  line: number;
  column: number;
  /**
   * 结构锚点（如 "0.1"）：JSX 层级路径。
   * 行号会因写回而漂移，结构锚点不会——两者交叉校验才能既防漂移又防改错元素。
   */
  anchor?: string;
}

/** 一条已应用的变更。 */
export interface ChangeRecord {
  id: string;
  filePath: string;
  /** 人类可读的变更描述，如 "间距 p-4 → p-6" */
  summary: string;
  /** 被替换掉的源码片段 */
  before: string;
  /** 替换后的源码片段 */
  after: string;
  diff: FileDiff;
  createdAt: number;
  /** 撤销用：定位信息 */
  locator?: ElementLocator;
}

export type ClientMessage =
  | { type: 'hello' }
  | {
      type: 'requestChange';
      payload: {
        locator: ElementLocator;
        op: StyleOp | LayoutOp;
        /** UI 层给出的可读描述 */
        summary: string;
      };
    }
  /**
   * 结构编辑（插入 / 删除 / 复制节点）。
   *
   * 与 requestChange 分开的理由：它**会重排同级元素的结构锚点**，
   * 属于"变更定位基准"的操作，客户端必须等 HMR 落地并刷新锚点后才能继续编辑。
   */
  | {
      type: 'requestStructure';
      payload: {
        locator: ElementLocator;
        op: StructureOp;
        summary: string;
      };
    }
  | { type: 'undo'; payload: { changeId: string } }
  | { type: 'history' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'ready'; payload: { projectRoot: string; clientCount: number } }
  | {
      type: 'changeApplied';
      payload: {
        change: ChangeRecord;
        /**
         * 写回后元素的新结构锚点。
         * 写回会改变文件内容 → 行号漂移 → 客户端靠新锚点重新定位。
         */
        anchor?: string;
        /**
         * 结构编辑后应该选中的元素。
         * 插入 → 新节点；删除 → 父节点；客户端据此在 HMR 后找到目标。
         */
        select?: { anchor: string; line: number; column: number };
      };
    }
  | { type: 'changeUndone'; payload: { changeId: string } }
  | { type: 'history'; payload: { changes: ChangeRecord[] } }
  | { type: 'error'; payload: { message: string; detail?: string } }
  | { type: 'pong' };
