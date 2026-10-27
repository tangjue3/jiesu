/**
 * 解析「生成的项目该怎么引用 jiesu 插件」。
 *
 * 背景：jiesu 还没发布到 npm（package.json 里是 private: true），
 * 所以生成的项目如果写 `"jiesu": "^0.5.0"`，`npm install` 会直接失败——
 * npm 上没有这个包。于是"创建项目 → 装依赖 → npm run dev"这条最基本的链路是断的。
 *
 * 两种引用方式（按**当前这个 jiesu 自己是怎么被装进来的**判断，不猜）：
 *
 * | 场景 | 判据 | package.json 依赖 | vite.config.ts import |
 * |---|---|---|---|
 * | 本地开发/自测 | 包目录不在 node_modules 下 | `file:/绝对路径` | `jiesu/vite-plugin` |
 * | npm 发布后 | 包目录在 node_modules 下 | `^<真实版本>` | `jiesu/vite-plugin` |
 *
 * 为什么本地模式用 `file:` 而不是把绝对路径写进 vite.config.ts：
 *  - `file:` 会被 npm 装成软链，import 标识符保持 `jiesu/vite-plugin`，
 *    和发布后的样子一模一样——发布时只要换依赖字符串，配置文件一行都不用改；
 *  - 绝对路径写进配置文件，Vite 的配置打包与依赖解析都要特殊处理，容易踩坑。
 *
 * 代价要说清楚：`file:` 里的绝对路径绑死本机，这个项目不能直接分享给别人。
 * 所以生成项目的 README 里会写明这一点（见 templates.ts 的 installNote）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PluginRef } from '../core/scaffold/templates.js';
import { EditError } from './session.js';

/** 插件引用方式 + 给用户看的说明。 */
export interface ResolvedPluginRef extends PluginRef {
  /** true 表示当前引用的是本地开发目录（file: 依赖） */
  local: boolean;
  /**
   * 一句话摘要，给 CLI 输出用（比 installNote 短）。
   * 写进生成项目 README 的是 installNote。
   */
  note: string;
}

interface PackageManifest {
  name?: string;
  version?: string;
}

/**
 * 往上找 jiesu 自己的包目录：找 name === 'jiesu' 的 package.json。
 *
 * 为什么用「往上找」而不是写死路径：
 * 这一份代码会被打进 `dist/cli/bin.js`（那时 import.meta.url 落在 dist/cli/），
 * 从源码跑时又落在 src/server/ —— 两处深度不同，写死任何一条都会在另一处失效。
 * 往上找 name 匹配的 package.json，两种形态都对。
 */
export function findPackageRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  // 上限 8 层：足够穿过 src/server、dist/cli，也够穿过 node_modules/jiesu
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as PackageManifest;
        if (parsed.name === 'jiesu') return dir;
      } catch {
        /* package.json 坏了就当这个目录不是，继续往上找 */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 判断包目录是不是被 npm 装在 node_modules 下（即：正式发布后的形态）。 */
function isInstalledFromNpm(packageRoot: string): boolean {
  return basename(dirname(packageRoot)) === 'node_modules';
}

/**
 * 算出生成项目该用的插件引用。
 *
 * 找不到自己的包目录时**明确报错**，不猜一个版本号出去——
 * 猜出来的依赖装不上，用户看到的失败信息会指向错误的方向。
 */
export function resolvePluginRef(): ResolvedPluginRef {
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (!packageRoot) {
    throw new EditError(
      '找不到 jiesu 自身的包目录，无法确定插件引用方式',
      '请在 jiesu 仓库内运行，或从 npm 安装后使用',
    );
  }

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest;
  } catch (error) {
    throw new EditError(
      'jiesu 自身的 package.json 读不出来',
      error instanceof Error ? error.message : String(error),
    );
  }

  const version = typeof manifest.version === 'string' && manifest.version.length > 0
    ? manifest.version
    : '0.0.0';

  if (isInstalledFromNpm(packageRoot)) {
    return {
      importPath: 'jiesu/vite-plugin',
      dependency: `^${version}`,
      local: false,
      note: `jiesu 插件来自 npm（^${version}）。`,
      installNote: `jiesu 插件来自 npm（\`^${version}\`），直接 \`npm install\` 即可。`,
    };
  }

  // 本地开发形态：用 file: 协议，npm 会把它装成软链，import 标识符不用变
  const fileSpec = `file:${packageRoot}`;
  const note = [
    `当前用的是**本地开发版** jiesu（\`${packageRoot}\`），`,
    `所以 package.json 里写的是 \`"jiesu": "${fileSpec}"\`——npm 会把它装成软链，改动立即生效。`,
    '',
    '代价：这个项目绑死了本机路径，不能直接分享给别人。',
    '等 jiesu 发布到 npm 后，把这一行改回 `"jiesu": "^<版本号>"` 即可，',
    'vite.config.ts 里的 import 不用动。',
  ].join('\n');
  return {
    importPath: 'jiesu/vite-plugin',
    dependency: fileSpec,
    local: true,
    note,
    installNote: note,
  };
}

/** 供测试与文档引用：当前包根目录（找不到时返回 null）。 */
export function currentPackageRoot(): string | null {
  return findPackageRoot(dirname(fileURLToPath(import.meta.url)));
}

export { sep };
