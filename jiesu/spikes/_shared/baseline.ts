/**
 * e2e 靶场基线管理。
 *
 * 为什么需要它：所有 e2e 的断言都基于"原始文件内容"。如果直接从工作区读，
 * 那么**上一次被中断的测试**、或者**用户自己在演示里拖了一下**，
 * 都会把基线带歪——断言随后会以"expected false to be true"这种毫无信息量的方式失败。
 *
 * 所以基线一律从 git HEAD 取，并把文件还原成干净状态。
 *
 * ⚠️ **所有 e2e 在模块加载时（describe 外）就调这个函数**，而 vitest 会用多个
 * worker 进程并行加载测试文件 —— 于是多个 `git checkout` 同时执行，撞
 * `.git/index.lock`：除了一个成功，其余全部
 * `fatal: Unable to create '.git/index.lock': File exists`。
 *
 * 这个错误以前被 catch 静默吞掉，于是走"按现状跑"分支，
 * **返回的是被污染的当前文件而不是 HEAD 基线**，断言随即以无信息量的方式失败
 * （典型症状：`expected false to be true`，或"变更篮是空的"）。
 *
 * 所以：**进程内的锁挡不住跨进程冲突**（每个 worker 是独立进程，模块级变量不共享），
 * 真正的修法是失败后重试 —— 冲突是短暂的（另一个 git 几十毫秒就结束）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/** 同一进程内的锁：至少挡住同 worker 内的多个文件。 */
let locked = false;

/** 同步 sleep（Node 没有别的同步 sleep 可用）。 */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(): void {
  const deadline = Date.now() + 30_000;
  while (locked) {
    if (Date.now() > deadline) return;
    sleep(2);
  }
  locked = true;
}

/** 跑 git，遇到 index.lock 冲突就退避重试（跨进程冲突只能这么解决）。 */
function gitWithRetry(args: string[], cwd: string): void {
  const deadline = Date.now() + 30_000;
  let attempt = 0;
  for (;;) {
    try {
      execFileSync('git', args, { cwd, stdio: 'ignore' });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isLockConflict = /index\.lock|Another git process/.test(message);
      attempt += 1;
      // 只有锁冲突值得重试；其余（没有 git、文件未入库）直接放弃
      if (!isLockConflict || Date.now() > deadline) return;
      // 指数退避：2ms → 4ms → 8ms … 上限 100ms
      sleep(Math.min(100, 2 ** Math.min(attempt, 6)));
    }
  }
}

/** 从 git HEAD 还原某个文件，并返回其内容。 */
export function resetFromHead(absPath: string): string {
  acquire();
  try {
    try {
      const cwd = dirname(absPath);
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      gitWithRetry(['checkout', '--', relative(root, absPath)], root);
    } catch {
      // 没有 git / 文件尚未入库 → 按现状跑
    }
    return readFileSync(absPath, 'utf8');
  } finally {
    locked = false;
  }
}
