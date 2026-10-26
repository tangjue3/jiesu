import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import {
  scaffoldProject,
  validateProjectName,
  type PluginRef,
} from '../core/scaffold/templates.js';
import { EditError } from './session.js';

export interface CreateProjectOptions {
  /** 新项目建在哪个目录下（必须是已存在的绝对路径） */
  parentDir: string;
  name: string;
  title?: string;
  plugin?: PluginRef;
}

export interface CreatedProject {
  /** 新项目根目录（绝对路径） */
  root: string;
  /** 写出的文件（相对项目根的 posix 路径） */
  files: string[];
}

/**
 * 在磁盘上创建一个真实可跑的 Vite + React + TS + Tailwind 项目。
 *
 * 纪律：
 *  - **绝不覆盖**：目标目录已存在且非空 → 拒绝并说明；任何一个目标文件已存在 → 整体放弃
 *    （宁可什么都不做，也不留一个半成品项目让人排查）
 *  - **不猜路径**：父目录必须是绝对路径且已存在，项目名不允许含分隔符
 */
export function createProject(options: CreateProjectOptions): CreatedProject {
  const { parentDir, name } = options;

  if (!isAbsolute(parentDir)) {
    throw new EditError('父目录必须是绝对路径', parentDir);
  }
  if (!existsSync(parentDir)) {
    throw new EditError('父目录不存在', parentDir);
  }
  if (!statSync(parentDir).isDirectory()) {
    throw new EditError('父路径不是目录', parentDir);
  }

  const check = validateProjectName(name);
  if (!check.ok) throw new EditError(check.reason, name);

  const root = resolve(parentDir, name);
  // 名字已被 validateProjectName 限制为不含分隔符，这里再做一次兜底
  if (!root.startsWith(resolve(parentDir) + sep)) {
    throw new EditError('项目路径越界，已拒绝', name);
  }

  if (existsSync(root)) {
    if (!statSync(root).isDirectory()) {
      throw new EditError('同名文件已存在', root);
    }
    const entries = readdirSync(root).filter((entry) => entry !== '.DS_Store');
    if (entries.length > 0) {
      throw new EditError(
        `目录已存在且不为空（${entries.length} 项），不会覆盖已有内容`,
        root,
      );
    }
  }

  const files = scaffoldProject({
    name,
    title: options.title,
    plugin: options.plugin,
  });

  // 预检：任何目标文件已存在就整体放弃，避免留下半个项目
  for (const file of files) {
    const abs = join(root, file.path);
    if (existsSync(abs)) {
      throw new EditError('目标文件已存在，已放弃创建', abs);
    }
  }

  mkdirSync(root, { recursive: true });
  for (const file of files) {
    const abs = join(root, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, 'utf8');
  }

  return { root, files: files.map((file) => file.path) };
}
