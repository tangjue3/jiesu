/**
 * S6 补强 · 生成的项目必须真的能装、能跑。
 *
 * 为什么要有这个测试文件：
 * 之前"脚手架能生成文件"与"生成的项目能用"是两件事，中间断了没人知道——
 * 生成的 package.json 写的是 `"jiesu": "^0.5.0"`，而 jiesu 根本还没发布到 npm，
 * 所以 `npm install` 必然失败。但所有测试都绿，因为它们只断言"文件写对了"。
 *
 * 这正是本项目第三次踩到的坑：**只测源码、不测产物 / 不测真实链路**。
 * 所以这里的判据不是"package.json 里有某个字符串"，而是：
 *   1. 依赖声明指向真实存在的本地包（file: 协议）
 *   2. npm install 真能装完（不报 "No matching version found"）
 *   3. 装完之后 `jiesu/vite-plugin` 这个子路径能被 Node 解析
 *   4. vite 能起来，覆盖层脚本能取到（发布形态下插件里没有 TS 源可读）
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { resolvePluginRef, findPackageRoot } from '../../src/server/plugin-ref';
import { createProject } from '../../src/server/scaffold';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(HERE, '.sandbox-install');
const PKG_ROOT = resolve(HERE, '..', '..');
/**
 * 这个用例起一个独立的 vite（子进程）。端口必须与 e2e 用的 5201~5211 错开，
 * 否则 `--strictPort` 会让其中一个起不来（e2e 是固定端口，撞上就直接失败）。
 */
const VITE_PORT = 5420;
const DIST_PLUGIN = join(PKG_ROOT, 'dist', 'vite-plugin', 'index.js');

function cleanSandbox(): void {
  try {
    rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    /* 沙箱在 .gitignore 内，清理失败不视为测试失败 */
  }
}

describe('S6+ · 生成的项目真的能装能跑', () => {
  afterAll(cleanSandbox);

  it('依赖声明指向真实存在的本地包（而不是一个 npm 上没有的版本号）', () => {
    cleanSandbox();
    mkdirSync(SANDBOX, { recursive: true });
    const created = createProject({ parentDir: SANDBOX, name: 'dep-check' });

    const pkg = JSON.parse(readFileSync(join(created.root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const spec = pkg.dependencies.jiesu;

    // 关键：不能是 "^0.x.0" 这种版本号——jiesu 还没发布，npm 上没有
    expect(spec).toMatch(/^file:/);
    // file: 后面跟的路径必须真实存在
    const target = spec.slice('file:'.length);
    expect(existsSync(join(target, 'package.json'))).toBe(true);

    // vite.config.ts 里的 import 标识符与发布形态一致（改依赖即可，不用改配置）
    const config = readFileSync(join(created.root, 'vite.config.ts'), 'utf8');
    expect(config).toContain("from 'jiesu/vite-plugin'");
  });

  it('package.json 的 exports 暴露了 ./vite-plugin 子路径（否则 import 解析不到）', () => {
    const manifest = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(manifest.exports['./vite-plugin']).toBe('./dist/vite-plugin/index.js');
    // 声明了 exports 就不能漏掉子路径——只有 "." 的话 'jiesu/vite-plugin' 会解析失败
    expect(Object.keys(manifest.exports)).toContain('./vite-plugin');
  });

  it('npm install 真能装完，且 jiesu/vite-plugin 子路径能被解析', () => {
    cleanSandbox();
    mkdirSync(SANDBOX, { recursive: true });
    const created = createProject({ parentDir: SANDBOX, name: 'installable' });

    // 需要 dist 产物（file: 软链指向的就是本仓库）
    if (!existsSync(DIST_PLUGIN)) {
      execSync('node scripts/build.mjs', { cwd: PKG_ROOT, stdio: 'ignore' });
    }
    expect(existsSync(DIST_PLUGIN)).toBe(true);

    // 真装一次。这条断言的价值：如果依赖写成了 npm 上不存在的版本号，
    // npm 会以 "No matching version found for jiesu" 失败——正是原来的 bug。
    let installError: string | null = null;
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: created.root,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300_000,
      });
    } catch (caught) {
      const err = caught as { stdout?: string; stderr?: string };
      installError = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
    }
    expect(installError, `npm install 失败：\n${installError ?? ''}`).toBeNull();

    // 装完之后子路径必须真的能 import（exports 配错的话这里会炸）
    const probe = [
      "import('jiesu/vite-plugin')",
      '  .then((m) => { if (typeof m.jiesu !== "function") { process.exit(3); } console.log("OK"); })',
      '  .catch((e) => { console.error(e.code || e.message); process.exit(4); });',
    ].join('');
    const out = execFileSync(process.execPath, ['-e', probe], {
      cwd: created.root,
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('OK');
  }, 360_000);

  it('vite 能起来，且覆盖层脚本与位置注入都生效', async () => {
    cleanSandbox();
    mkdirSync(SANDBOX, { recursive: true });
    const created = createProject({
      parentDir: SANDBOX,
      name: 'bootable',
      plugin: { importPath: DIST_PLUGIN },
    });

    // 插件靠 .jiesu/server.json 拿端口；没有它就只注入位置、不注入覆盖层
    mkdirSync(join(created.root, '.jiesu'), { recursive: true });
    writeFileSync(
      join(created.root, '.jiesu', 'server.json'),
      JSON.stringify({ port: VITE_PORT, host: '127.0.0.1' }),
      'utf8',
    );

    const viteBin = join(PKG_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const { spawn } = await import('node:child_process');
    const child = spawn(
      process.execPath,
      [viteBin, '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'],
      { cwd: created.root, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const output: string[] = [];
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));

    try {
      const deadline = Date.now() + 30_000;
      let up = false;
      while (Date.now() < deadline && !up) {
        try {
          const res = await fetch(`http://127.0.0.1:${VITE_PORT}/`);
          up = res.ok;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      expect(up, `vite 没起来，输出：\n${output.join('')}`).toBe(true);

      const html = await (await fetch(`http://127.0.0.1:${VITE_PORT}/`)).text();
      expect(html).toContain('__JIESU_PORT__');
      expect(html).toContain('__x00__jiesu-client');

      // 每个 JSX 元素都拿到了位置属性
      const app = await (await fetch(`http://127.0.0.1:${VITE_PORT}/src/App.tsx`)).text();
      expect(app).toContain('data-jiesu-src');
      expect(app).toContain('data-jiesu-id');

      // 覆盖层脚本本身必须能取到（发布形态下插件里没有 TS 源可读）
      const overlay = await fetch(`http://127.0.0.1:${VITE_PORT}/@id/__x00__jiesu-client`);
      expect(overlay.status).toBe(200);
      expect(await overlay.text()).toContain('data-jiesu-overlay');
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((r) => {
        child.on('exit', () => r());
        setTimeout(r, 5000);
      });
    }
  }, 120_000);
});

describe('S6+ · 插件引用解析', () => {
  it('本地开发形态：解析出 file: 依赖，并带上说明', () => {
    const ref = resolvePluginRef();
    expect(ref.local).toBe(true);
    expect(ref.dependency).toBe(`file:${PKG_ROOT}`);
    expect(ref.importPath).toBe('jiesu/vite-plugin');
    // 说明要写进 README，得说清"绑死本机路径"这个代价
    expect(ref.installNote).toContain('file:');
    expect(ref.installNote).toContain('不能直接分享');
  });

  it('找不到自己的包目录时明确报错，而不是猜一个版本号', () => {
    // findPackageRoot 从一个无关目录往上找，不该找到 jiesu
    expect(findPackageRoot('/tmp')).toBeNull();
  });
});
