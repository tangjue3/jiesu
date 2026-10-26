import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { startServer } from '../server/server.js';

export interface CliOptions {
  root?: string;
  port?: number;
  host?: string;
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
      '',
      '  下一步：',
      '   1. 在 vite.config.ts 中加入插件（顺序很重要）：',
      '        plugins: [jiesu(), react()]',
      '   2. 启动你的开发服务器：npm run dev',
      '   3. 在页面上按 Alt+Shift+J 进入选择模式',
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
