import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createProject } from '../server/scaffold.js';
import { startServer } from '../server/server.js';

export interface CliOptions {
  root?: string;
  port?: number;
  host?: string;
}

export interface NewOptions {
  /** 新项目建在哪个目录下（通常是 process.cwd()） */
  cwd: string;
  name?: string;
  title?: string;
}

export interface NewResult {
  ok: boolean;
  root?: string;
  reason?: string;
}

/**
 * `jiesu new <name>`：生成一个真实可跑的项目。
 *
 * 失败一律写清楚原因并返回 ok:false（由 bin 决定退出码），
 * 绝不"猜一个替代名字"或"清空已有目录再建"。
 */
export function runNew(options: NewOptions): NewResult {
  const name = options.name ?? 'jiesu-app';
  try {
    const created = createProject({
      parentDir: resolve(options.cwd),
      name,
      title: options.title,
    });
    process.stdout.write(
      [
        '',
        `  已在 ${created.root} 创建项目（${created.files.length} 个文件）`,
        '',
        '  下一步：',
        `    cd ${name}`,
        '    npm install',
        '    npx jiesu        # 另开一个终端，启动编辑服务',
        '    npm run dev      # 打开页面后按 Alt+Shift+J 进入编辑模式',
        '',
      ].join('\n'),
    );
    return { ok: true, root: created.root };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n  创建失败：${reason}\n\n`);
    return { ok: false, reason };
  }
}

/**
 * jiesu CLI：启动本地编辑服务，并把连接信息写进项目，供 Vite 插件读取。
 */
export async function runCli(options: CliOptions = {}): Promise<void> {
  const projectRoot = resolve(options.root ?? process.cwd());
  const server = await startServer({
    projectRoot,
    port: options.port,
    host: options.host,
  });

  const metaDir = join(projectRoot, '.jiesu');
  mkdirSync(metaDir, { recursive: true });
  const metaFile = join(metaDir, 'server.json');
  writeFileSync(
    metaFile,
    JSON.stringify({ port: server.port, host: server.host, pid: process.pid, startedAt: Date.now() }, null, 2),
    'utf8',
  );

  process.stdout.write(
    [
      '',
      '  jiesu 编辑服务已启动',
      `  项目根目录  ${projectRoot}`,
      `  服务地址    ws://${server.host}:${server.port}/ws`,
      `  Studio      http://${server.host}:${server.port}/studio`,
      '',
      '  下一步：',
      '   1. 在 vite.config.ts 中加入插件（顺序很重要）：',
      '        plugins: [jiesu(), react()]',
      '   2. 启动你的开发服务器：npm run dev',
      '   3. 打开 Studio，把开发服务器地址填进顶栏（例如 http://localhost:5173），',
      '      或在地址后加 ?url=http://localhost:5173 直接进画布',
      '   4. 页面里按 Alt+Shift+J 开始选择元素',
      '',
      '  按 Ctrl+C 退出',
      '',
    ].join('\n'),
  );

  const cleanup = async (): Promise<void> => {
    rmSync(metaFile, { force: true });
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void cleanup());
  process.on('SIGTERM', () => void cleanup());
}
