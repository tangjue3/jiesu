/**
 * e2e 靶场基线管理。
 *
 * 为什么需要它：所有 e2e 的断言都基于"原始文件内容"。如果直接从工作区读，
 * 那么**上一次被中断的测试**、或者**用户自己在演示里拖了一下**，
 * 都会把基线带歪——断言随后会以"expected false to be true"这种毫无信息量的方式失败。
 *
 * 所以基线一律从 git HEAD 取，并把文件还原成干净状态。
 * 拿不到 git（例如代码被复制成压缩包）时才退回读当前文件。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/** 从 git HEAD 还原某个文件，并返回其内容。 */
export function resetFromHead(absPath: string): string {
  try {
    const cwd = dirname(absPath);
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    execFileSync('git', ['checkout', '--', relative(root, absPath)], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    // 没有 git / 文件尚未入库 → 按现状跑
  }
  return readFileSync(absPath, 'utf8');
}
