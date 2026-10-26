import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { applyLayoutOp, type LayoutOp } from '../core/layout/apply-layout.js';
import { applyOp, type StyleOp } from '../core/write/apply.js';
import type { ChangeRecord, ElementLocator } from './protocol.js';

export class EditError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'EditError';
  }
}

/** 一次写回的完整结果。 */
export interface ApplyOutcome {
  record: ChangeRecord;
  /** 写回后元素的新结构锚点 */
  anchor?: string;
}

/**
 * 编辑会话：负责把一次可视化操作落到磁盘上，并维护可撤销的变更历史。
 *
 * 这里是"变更篮"的落点：每条变更都带 before/after 片段，撤销 = 把片段换回去。
 */
export class EditSession {
  private readonly changes: ChangeRecord[] = [];
  private counter = 0;

  constructor(private readonly projectRoot: string) {}

  getChanges(): ChangeRecord[] {
    return [...this.changes];
  }

  /** 相对路径 → 项目内绝对路径；越界一律拒绝。 */
  resolvePath(filePath: string): string {
    const abs = isAbsolute(filePath) ? filePath : resolve(this.projectRoot, filePath);
    const rel = relative(this.projectRoot, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new EditError('目标文件不在项目目录内，已拒绝写入', filePath);
    }
    return abs;
  }

  applyStyleChange(
    locator: ElementLocator,
    op: StyleOp,
    summary: string,
  ): ApplyOutcome {
    return this.applyChange(locator, op, summary, 'style');
  }

  applyLayoutChange(
    locator: ElementLocator,
    op: LayoutOp,
    summary: string,
  ): ApplyOutcome {
    return this.applyChange(locator, op, summary, 'layout');
  }

  private applyChange(
    locator: ElementLocator,
    op: StyleOp | LayoutOp,
    summary: string,
    kind: 'style' | 'layout',
  ): ApplyOutcome {
    const absPath = this.resolvePath(locator.filePath);
    if (!existsSync(absPath)) {
      throw new EditError('源文件不存在', locator.filePath);
    }
    const original = readFileSync(absPath, 'utf8');

    const result =
      kind === 'style'
        ? applyOp(original, locator, op as StyleOp)
        : applyLayoutOp(original, locator, op as LayoutOp);

    if (result.status !== 'ok') {
      throw new EditError(result.reason ?? '无法应用该修改', `status=${result.status}`);
    }
    if (!result.changed || !result.code) {
      throw new EditError('该修改没有产生任何变化');
    }

    this.writeFileAtomic(absPath, result.code);

    const diff = result.diff ?? {
      startLine: 0,
      endLine: 0,
      before: '',
      after: '',
    };
    const beforeFragment = this.pickFragment(original, result.code, 'before');
    const afterFragment = this.pickFragment(original, result.code, 'after');

    const record: ChangeRecord = {
      id: `chg_${++this.counter}`,
      filePath: locator.filePath,
      summary,
      before: beforeFragment,
      after: afterFragment,
      diff,
      createdAt: Date.now(),
      locator: { ...locator, anchor: result.anchor ?? locator.anchor },
    };
    this.changes.push(record);
    return { record, anchor: result.anchor };
  }

  /** 撤销一条变更：把 after 片段换回 before。 */
  undo(changeId: string): ChangeRecord {
    const index = this.changes.findIndex((c) => c.id === changeId);
    if (index === -1) throw new EditError('找不到该变更记录', changeId);

    const record = this.changes[index];
    const absPath = this.resolvePath(record.filePath);
    const content = readFileSync(absPath, 'utf8');

    if (record.after.length === 0) {
      throw new EditError('该变更没有可回滚的片段');
    }

    const occurrences = content.split(record.after).length - 1;
    if (occurrences === 0) {
      throw new EditError('代码已变化，无法安全回滚该条变更');
    }
    if (occurrences > 1) {
      throw new EditError(
        `代码中有 ${occurrences} 处相同片段，无法确定回滚位置，请手动处理`,
      );
    }

    const reverted = content.replace(record.after, record.before);
    this.writeFileAtomic(absPath, reverted);
    this.changes.splice(index, 1);
    return record;
  }

  /** 从 diff 里取一小段可读文本作为变更片段。 */
  private pickFragment(original: string, updated: string, side: 'before' | 'after'): string {
    const lines = (side === 'before' ? original : updated).split('\n');
    // 取第一处发生变化行的邻近片段（最多 3 行）
    const otherLines = (side === 'before' ? updated : original).split('\n');
    for (let i = 0; i < Math.max(lines.length, otherLines.length); i += 1) {
      if (lines[i] !== otherLines[i]) {
        return lines.slice(i, i + 3).join('\n').trim();
      }
    }
    return '';
  }

  private writeFileAtomic(absPath: string, content: string): void {
    const tmp = `${absPath}.jiesu-tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, absPath);
  }
}
