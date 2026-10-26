/**
 * 构建脚本：把三个入口打包成可发布产物。
 *   dist/cli/bin.js        —— npx jiesu 的可执行入口
 *   dist/vite-plugin/index.js —— 用户项目里引用的插件
 */
import { build } from 'esbuild';

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'info',
  sourcemap: true,
};

await build({
  ...shared,
  entryPoints: ['src/cli/bin.ts'],
  outfile: 'dist/cli/bin.js',
  banner: { js: '#!/usr/bin/env node' },
  external: ['ws'],
});

await build({
  ...shared,
  entryPoints: ['src/vite-plugin/index.ts'],
  outfile: 'dist/vite-plugin/index.js',
  external: ['vite', 'esbuild'],
});

process.stdout.write('\n构建完成：dist/cli/bin.js · dist/vite-plugin/index.js\n');
