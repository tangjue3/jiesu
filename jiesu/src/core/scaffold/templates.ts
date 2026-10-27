/**
 * 新项目脚手架 —— 纯函数，输入一个项目名，输出一组「文件路径 + 内容」。
 *
 * 为什么要有这个：
 * UI 参考 V2 里「创建空白画布」必须先落到磁盘上成为一个真实项目，
 * 否则画布上拖的东西没有"代码是唯一真实来源"可言（那就变成 JSON 文档 + codegen 了）。
 *
 * 三条纪律：
 *  1. **这一层不碰磁盘**：只产出文件清单，落盘在 src/server/scaffold.ts。
 *     好处是可以脱离文件系统单测，也保证内核不依赖 IO 顺序。
 *  2. **生成的项目开箱即用**：装完依赖 `npm run dev` 就能跑，且已带 Tailwind v4。
 *  3. **已带 jiesu 插件**：用户不必再自己改 vite.config —— 这是"创建即被编辑"的前提。
 */

export interface ProjectFile {
  /** 相对项目根目录的 posix 路径 */
  path: string;
  content: string;
}

/**
 * 插件引用方式。
 *
 * importPath：生成的 vite.config.ts 里 import 的模块标识。
 * dependency：package.json 里声明的依赖版本；`undefined` 表示不写进依赖
 *   （本地绝对路径引用时用不到依赖声明）。
 * installNote：写进生成项目 README 的说明（当前引用的是本地开发版还是 npm 版）。
 *   `undefined` 表示不写这段（默认情况，用户不需要知道这些细节）。
 */
export interface PluginRef {
  importPath: string;
  dependency?: string;
  installNote?: string;
}

/**
 * 发布形态下的插件 import 标识。
 *
 * 为什么这里没有默认的 dependency：
 * 版本号只有一个真源——jiesu 自己的 package.json。
 * 模板层是纯函数、不碰磁盘，读不到它；硬编码一个版本必然会漂移
 * （之前就漂移过：包里写 ^0.5.0，实际版本是 0.1.0，npm 上根本没有这个版本）。
 * 所以依赖声明由 server 层解析后传进来（见 src/server/plugin-ref.ts）。
 */
export const PUBLISHED_PLUGIN_IMPORT_PATH = 'jiesu/vite-plugin';

export interface ScaffoldOptions {
  /** 项目名，同时用作 package.json 的 name 与默认标题 */
  name: string;
  /** 页面标题（index.html 的 title 与 App 里的欢迎语） */
  title?: string;
  /**
   * 插件引用方式（必填）。
   *
   * 为什么必填而不给默认值：依赖版本必须来自真实来源，
   * 模板层不能靠一个写死的常量蒙混过去。
   */
  plugin: PluginRef;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** 校验项目名：既要是合法 npm 名，也要能当目录名（不猜、不自动改写）。 */
export function validateProjectName(name: string): { ok: true } | { ok: false; reason: string } {
  if (name.trim().length === 0) return { ok: false, reason: '项目名不能为空' };
  if (name.length > 64) return { ok: false, reason: '项目名不能超过 64 个字符' };
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: '项目名只能用小写字母、数字、点、下划线、连字符，且必须以字母或数字开头',
    };
  }
  return { ok: true };
}

/** 生成完整的项目文件清单（路径按字母序稳定输出，便于断言与 diff）。 */
export function scaffoldProject(options: ScaffoldOptions): ProjectFile[] {
  const check = validateProjectName(options.name);
  if (!check.ok) throw new Error(check.reason);

  const name = options.name;
  const title = options.title ?? name;
  const plugin = options.plugin;

  const dependencies: Record<string, string> = {
    react: '^19.0.0',
    'react-dom': '^19.0.0',
  };
  if (plugin.dependency) dependencies.jiesu = plugin.dependency;

  const files: ProjectFile[] = [
    {
      path: 'package.json',
      content: `${JSON.stringify(
        {
          name,
          private: true,
          version: '0.0.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            preview: 'vite preview',
          },
          dependencies,
          devDependencies: {
            '@tailwindcss/vite': '^4.0.0',
            '@types/react': '^19.0.0',
            '@types/react-dom': '^19.0.0',
            '@vitejs/plugin-react': '^5.0.0',
            tailwindcss: '^4.0.0',
            typescript: '^5.7.0',
            vite: '^7.0.0',
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'vite.config.ts',
      content: `import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { jiesu } from '${plugin.importPath}';

export default defineConfig({
  // 顺序要求：jiesu 必须在 react 之前（它要看到 JSX 源码，而不是编译产物）
  plugins: [jiesu(), react(), tailwindcss()],
});
`,
    },
    {
      path: 'tsconfig.json',
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
            skipLibCheck: true,
            isolatedModules: true,
            resolveJsonModule: true,
            noEmit: true,
            types: ['vite/client'],
          },
          include: ['src'],
        },
        null,
        2,
      )}\n`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.tsx',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('找不到 #root 挂载节点');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    },
    {
      path: 'src/index.css',
      content: `@import 'tailwindcss';
`,
    },
    {
      path: 'src/App.tsx',
      content: `export function App() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-16">
      <main className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">${title}</h1>
        <p className="mt-3 text-base leading-7 text-slate-600">
          这是一张空画布。用编辑器选中元素、改样式、拖组件进来，改动会直接写回这个文件。
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-base font-medium text-slate-900">第一块</h2>
            <p className="mt-1 text-sm text-slate-600">试着改它的间距或颜色。</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-base font-medium text-slate-900">第二块</h2>
            <p className="mt-1 text-sm text-slate-600">试着在它下面插一个按钮。</p>
          </div>
        </div>
      </main>
    </div>
  );
}
`,
    },
    {
      path: '.gitignore',
      content: `node_modules
dist
.DS_Store
.vite-cache
.jiesu
`,
    },
    {
      path: 'README.md',
      content: `# ${title}

由 jiesu（界塑）创建。

\`\`\`bash
npm install
npm run dev
\`\`\`

页面打开后按 \`Alt+Shift+J\` 进入编辑模式：点元素改样式、按住拖动改位置、面板底部插入组件。
所有改动都直接写回 \`src/App.tsx\`，不存在"导出"这一步。
${plugin.installNote ? `\n## 关于 jiesu 依赖\n\n${plugin.installNote}\n` : ''}`,
    },
  ];

  return files.sort((a, b) => a.path.localeCompare(b.path));
}
