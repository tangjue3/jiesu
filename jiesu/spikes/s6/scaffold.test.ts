/**
 * S6 脚手架：把「创建空白画布」落成真实项目。
 *
 * 成立性判据是三件事：
 *  1. 文件清单齐全且内容自洽（package.json 可解析、插件顺序正确）
 *  2. 拒绝覆盖已有内容（宁可什么都不做，也不留半个项目）
 *  3. **生成出来的项目真的能被 Vite 起起来，并且编辑器注入生效** —— 这条最关键，
 *     前两条只能证明"文件写对了"，证明不了"这个项目能用"
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createProject } from '../../src/server/scaffold';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(HERE, '.sandbox');
const DIST_PLUGIN = join(HERE, '..', '..', 'dist', 'vite-plugin', 'index.js');
const PORT = 5388;

async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeoutMs = 20000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

/** 清理沙箱；被安全删除拦截器挡住时不影响断言结果。 */
function cleanSandbox(): void {
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 沙箱已在 .gitignore 内，清理失败不视为测试失败 */
  }
}

describe('S6 · 脚手架生成真实项目', () => {
  afterAll(cleanSandbox);

  it('文件清单齐全，package.json 自洽', () => {
    cleanSandbox();
    mkdirSync(SANDBOX, { recursive: true });
    const created = createProject({ parentDir: SANDBOX, name: 'demo-app', title: '示例页面' });

    expect(created.files).toEqual(
      expect.arrayContaining([
        '.gitignore',
        'README.md',
        'index.html',
        'package.json',
        'src/App.tsx',
        'src/index.css',
        'src/main.tsx',
        'tsconfig.json',
        'vite.config.ts',
      ]),
    );

    const pkg = JSON.parse(readFileSync(join(created.root, 'package.json'), 'utf8')) as {
      name: string;
      type: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('demo-app');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.dependencies.react).toBeTruthy();
    expect(pkg.devDependencies.vite).toBeTruthy();
    expect(pkg.devDependencies.tailwindcss).toBeTruthy();

    // 标题进了 index.html 与首页欢迎语
    expect(readFileSync(join(created.root, 'index.html'), 'utf8')).toContain('<title>示例页面</title>');
    expect(readFileSync(join(created.root, 'src/App.tsx'), 'utf8')).toContain('示例页面');
    // Tailwind v4 的入口写法
    expect(readFileSync(join(created.root, 'src/index.css'), 'utf8')).toContain('@import');
  });

  it('vite.config 里 jiesu 必须在 react 之前（否则只能看到编译产物）', () => {
    cleanSandbox();
    mkdirSync(SANDBOX, { recursive: true });
    const created = createProject({ parentDir: SANDBOX, name: 'order-check' });
    const config = readFileSync(join(created.root, 'vite.config.ts'), 'utf8');

    const jiesuIndex = config.indexOf('jiesu()');
    const reactIndex = config.indexOf('react()');
    expect(jiesuIndex).toBeGreaterThan(-1);
    expect(reactIndex).toBeGreaterThan(-1);
    expect(jiesuIndex).toBeLessThan(reactIndex);
  });

  it('目录已存在且非空时拒绝，且不动已有文件', () => {
    cleanSandbox();
    const root = join(SANDBOX, 'occupied');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'keep.txt'), '别动我', 'utf8');

    expect(() => createProject({ parentDir: SANDBOX, name: 'occupied' })).toThrow(/不为空/);
    expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('别动我');
    // 没有偷偷写进任何文件
    expect(existsSync(join(root, 'package.json'))).toBe(false);
  });

  it('非法项目名直接拒绝，不自动改名', () => {
    mkdirSync(SANDBOX, { recursive: true });
    expect(() => createProject({ parentDir: SANDBOX, name: 'My App' })).toThrow(/项目名/);
    expect(() => createProject({ parentDir: SANDBOX, name: 'a/b' })).toThrow(/项目名/);
    expect(() => createProject({ parentDir: SANDBOX, name: '' })).toThrow(/项目名/);
  });

  it('父目录不存在时拒绝', () => {
    expect(() =>
      createProject({ parentDir: join(SANDBOX, 'nope'), name: 'x1' }),
    ).toThrow(/父目录不存在/);
  });

  it(
    '生成的项目真的能被 Vite 起起来，且编辑器注入生效',
    async () => {
      // 需要 dist 产物（插件以绝对路径被引用）；构建很快，缺了就现做
      if (!existsSync(DIST_PLUGIN)) {
        execSync('node scripts/build.mjs', { cwd: join(HERE, '..', '..'), stdio: 'ignore' });
      }
      expect(existsSync(DIST_PLUGIN)).toBe(true);

      cleanSandbox();
      mkdirSync(SANDBOX, { recursive: true });
      const created = createProject({
        parentDir: SANDBOX,
        name: 'runnable',
        plugin: { importPath: DIST_PLUGIN },
      });

      // 插件靠 .jiesu/server.json 拿到端口；没有它就只注入位置、不注入覆盖层
      mkdirSync(join(created.root, '.jiesu'), { recursive: true });
      writeFileSync(
        join(created.root, '.jiesu', 'server.json'),
        JSON.stringify({ port: 5399, host: '127.0.0.1' }),
        'utf8',
      );

      // 用子进程起真正的 `vite`（等价于用户 `npm run dev`），
      // 而不是 createServer —— 后者验证不到 CLI 这一层，且 middlewareMode 的 close 会挂住。
      const viteBin = join(HERE, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js');
      const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
        cwd: created.root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const output: string[] = [];
      child.stdout.on('data', (chunk) => output.push(String(chunk)));
      child.stderr.on('data', (chunk) => output.push(String(chunk)));

      try {
        const up = await waitFor(async () => {
          try {
            const res = await fetch(`http://127.0.0.1:${PORT}/`);
            return res.ok;
          } catch {
            return false;
          }
        }, 40_000);
        expect(up, `vite 没起来，输出：\n${output.join('')}`).toBe(true);

        const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
        // 覆盖层脚本被注入，且端口传进去了
        expect(html).toContain('__JIESU_PORT__');
        expect(html).toContain('5399');

        // 生成的 App.tsx 里每个 JSX 元素都拿到了位置属性（证明插件顺序对）
        const app = await (await fetch(`http://127.0.0.1:${PORT}/src/App.tsx`)).text();
        expect(app).toContain('data-jiesu-src');
        expect(app).toContain('data-jiesu-id');
        // React 插件照常工作
        expect(app).toContain('jsxDEV');

        // 覆盖层脚本本身也必须能拿到。
        // 发布形态下插件里没有 TS 源可读，只能读预先打好的 dist/client/overlay.js；
        // 少了这一步，页面会白屏而测试却全绿（只有真打开浏览器才发现）。
        const overlay = await fetch(`http://127.0.0.1:${PORT}/@id/__x00__jiesu-client`);
        expect(overlay.status).toBe(200);
        const overlayCode = await overlay.text();
        expect(overlayCode).toContain('data-jiesu-overlay');
        expect(overlayCode).toContain('__JIESU_PORT__');
      } finally {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          child.on('exit', () => resolve());
          setTimeout(resolve, 5000);
        });
      }
    },
    120_000,
  );
});

describe('S6 · 沙箱清理', () => {
  it('沙箱位于 spikes 内且被 gitignore 覆盖', () => {
    // 只是提醒：沙箱绝不能落到仓库外，否则清理逻辑就该被质疑
    expect(resolve(SANDBOX).startsWith(resolve(HERE))).toBe(true);
    expect(readFileSync(join(HERE, '..', '..', '.gitignore'), 'utf8')).toContain('.sandbox');
  });
});
