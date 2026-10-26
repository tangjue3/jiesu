import type { FileDiff } from '../core/write/apply.js';
import type { LayoutOp } from '../core/layout/apply-layout.js';
import type { StyleOp } from '../core/write/apply.js';

/** 元素在源码中的位置（与编译期注入的 data-jiesu-src 对应）。 */
export interface ElementLocator {
  filePath: string;
  line: number;
  column: number;
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
  | { type: 'changeApplied'; payload: { change: ChangeRecord } }
  | { type: 'changeUndone'; payload: { changeId: string } }
  | { type: 'history'; payload: { changes: ChangeRecord[] } }
  | { type: 'error'; payload: { message: string; detail?: string } }
  | { type: 'pong' };
