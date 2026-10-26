import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSync } from 'esbuild';
import type { Plugin } from 'vite';

import { injectSourceAttribute } from '../core/inject/jsx-source-attribute';

export interface JiesuPluginOptions {
  /** 注入的 DOM 属性名，默认 data-jiesu-src */
  attribute?: string;
  /** 只处理匹配的文件，默认 .tsx / .jsx / .ts / .js */
  include?: RegExp;
}

const DEFAULT_INCLUDE = /\.[jt]sx?$/;
const CLIENT_VIRTUAL_ID = '\0jiesu-client';
const CLIENT_PUBLIC_ID = '/@id/__x00__jiesu-client';

/** 构建产物里的覆盖层（发布形态）；从 src 跑时不存在，退回现场编译 TS。 */
const OVERLAY_DIST = new URL('../client/overlay.js', import.meta.url);
const OVERLAY_SRC = new URL('../client/index.ts', import.meta.url);

let overlayCache: string | null = null;

/**
 * 取覆盖层脚本。
 *
 * 为什么优先读 dist：插件被打包后 `import.meta.url` 落在 `dist/vite-plugin/`，
 * 那里已经没有 `src/client/index.ts` 可读，现场 buildSync 会直接抛错
 * （表现是页面白屏、且只有真打开页面才发现）。所以 build.mjs 会预先把
 * `dist/client/overlay.js` 打好，这里只做读取。
 */
function loadOverlayBundle(): string {
  if (overlayCache !== null) return overlayCache;

  const distPath = OVERLAY_DIST.pathname;
  if (existsSync(distPath)) {
    overlayCache = readFileSync(distPath, 'utf8');
    return overlayCache;
  }

  const result = buildSync({
    entryPoints: [OVERLAY_SRC.pathname],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
  });
  overlayCache = result.outputFiles[0].text;
  return overlayCache;
}

/**
 * jiesu 的 Vite 插件：
 *  1. dev 模式下给每个 JSX 元素注入源码位置属性（data-jiesu-src）
 *  2. 注入覆盖层脚本，页面右上角出现编辑面板
 *
 * 用法（顺序很重要，jiesu 必须在 react() 之前）：
 *   plugins: [jiesu(), react()]
 *
 * 为什么必须自己做注入：React 19 已移除 fiber._debugSource 与 props.__source，
 * 运行时无法从 DOM 反查源码位置（见 spikes/s1 的实测结论）。
 */
export function jiesu(options: JiesuPluginOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  let rootDir = process.cwd();
  let warned = false;

  return {
    name: 'jiesu',
    enforce: 'pre',
    apply: 'serve',

    configResolved(config) {
      rootDir = config.root;
    },

    resolveId(id) {
      if (id === CLIENT_VIRTUAL_ID || id === CLIENT_PUBLIC_ID) return CLIENT_VIRTUAL_ID;
      return null;
    },

    load(id) {
      if (id !== CLIENT_VIRTUAL_ID) return null;
      return loadOverlayBundle();
    },

    transformIndexHtml() {
      const port = readServerPort(rootDir);
      const tags: Array<{
        tag: string;
        attrs?: Record<string, string>;
        children?: string;
        injectTo: 'head-prepend' | 'body-prepend';
      }> = [];

      if (port) {
        tags.push({
          tag: 'script',
          children: `window.__JIESU_PORT__=${port};`,
          injectTo: 'head-prepend',
        });
      }
      tags.push({
        tag: 'script',
        attrs: { src: CLIENT_PUBLIC_ID },
        injectTo: 'head-prepend',
      });
      return tags;
    },

    transform(code, id) {
      const filePath = id.split('?')[0];
      if (!include.test(filePath)) return null;
      if (filePath.includes('/node_modules/')) return null;

      const result = injectSourceAttribute(code, {
        filePath,
        rootDir,
        attribute: options.attribute,
      });

      if (result.tooLate && !warned) {
        warned = true;
        this.warn(
          '[jiesu] 注入时机太晚：JSX 已被编译。请把插件顺序改为 plugins: [jiesu(), react()]',
        );
      }

      if (result.injected === 0) return null;
      return {
        code: result.code,
        map: result.map ? result.map.toString() : null,
      };
    },
  };
}

/** 读取 CLI 写入的 server 信息（端口等）。 */
export function readServerPort(rootDir: string): number | null {
  const file = join(rootDir, '.jiesu', 'server.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { port?: number };
    return typeof parsed.port === 'number' ? parsed.port : null;
  } catch {
    return null;
  }
}

export default jiesu;
