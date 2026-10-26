/**
 * 构建脚本：把两个入口打包成可发布产物。
 *   dist/cli/bin.js            —— npx jiesu 的可执行入口
 *   dist/vite-plugin/index.js  —— 用户项目里引用的插件
 *
 * 核心代码（@babel/parser / magic-string / 覆盖层脚本）会被内联进产物，
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
  // 注意：不要在这里加 banner 的 shebang。
  // src/cli/bin.ts 自带 shebang，esbuild 会保留它；
  // 再叠一个 banner 会变成两行 #!，Node 只认第一行，第二个直接语法错误。
  external: ['ws'],
});

await build({
  ...shared,
  entryPoints: ['src/vite-plugin/index.ts'],
  outfile: 'dist/vite-plugin/index.js',
  external: ['vite', 'esbuild'],
});

process.stdout.write('\n构建完成：dist/cli/bin.js · dist/vite-plugin/index.js\n');
