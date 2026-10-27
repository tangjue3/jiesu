/**
 * 构建脚本：把三个入口打包成可发布产物。
 *   dist/cli/bin.js            —— npx jiesu 的可执行入口
 *   dist/vite-plugin/index.js  —— 用户项目里引用的插件
 *   dist/client/overlay.js     —— 浏览器覆盖层（插件运行时读它，不再现场编译 TS）
 *
 * 核心代码（@babel/parser / magic-string）会被内联进产物，
 * 所以它们留在 devDependencies；只有 ws 与 esbuild 是运行时依赖。
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
  // esbuild 只在"从源码跑 Studio"这条兜底路径里用，打进 ESM 产物会因为它的 CJS
  // `require('fs')` 在加载期直接崩（Dynamic require of "fs" is not supported）。
  // 发布形态读预打好的 dist/studio/main.js，走不到这条路径。
  // 注意：不要在这里加 banner 的 shebang。
  // src/cli/bin.ts 自带 shebang，esbuild 会保留它；
  // 再叠一个 banner 会变成两行 #!，Node 只认第一行，第二个直接语法错误。
  external: ['ws', 'esbuild'],
});

await build({
  ...shared,
  entryPoints: ['src/vite-plugin/index.ts'],
  outfile: 'dist/vite-plugin/index.js',
  external: ['vite', 'esbuild'],
});

// 覆盖层必须**预先**打好：插件在 dist 里跑时已没有 src/client/index.ts 可读，
// 现场 buildSync 会直接失败（发布版页面白屏、且只有真点一下页面才会发现）。
await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'dist/client/overlay.js',
  bundle: true,
  write: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: false,
});

// Studio 前端同理：打包后没有 src/studio/main.ts 可读，必须预先产出
await build({
  entryPoints: ['src/studio/main.ts'],
  outfile: 'dist/studio/main.js',
  bundle: true,
  write: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: false,
});

process.stdout.write(
  '\n构建完成：dist/cli/bin.js · dist/vite-plugin/index.js · dist/client/overlay.js · dist/studio/main.js\n',
);
