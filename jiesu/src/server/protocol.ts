import type { FileDiff } from '../core/write/apply.js';
import type { LayoutOp } from '../core/layout/apply-layout.js';
import type { StyleOp } from '../core/write/apply.js';

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
      };
    }
  | { type: 'changeUndone'; payload: { changeId: string } }
  | { type: 'history'; payload: { changes: ChangeRecord[] } }
  | { type: 'error'; payload: { message: string; detail?: string } }
  | { type: 'pong' };
