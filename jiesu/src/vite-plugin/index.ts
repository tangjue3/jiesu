import type { Plugin } from 'vite';

import { injectSourceAttribute } from '../core/inject/jsx-source-attribute';

export interface JiesuPluginOptions {
  /** 注入的 DOM 属性名，默认 data-jiesu-src */
  attribute?: string;
  /** 只处理匹配的文件，默认 .tsx / .jsx / .ts / .js */
  include?: RegExp;
}

const DEFAULT_INCLUDE = /\.[jt]sx?$/;

/**
 * jiesu 的 Vite 插件：在 dev 模式下给每个 JSX 元素注入源码位置属性。
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

export default jiesu;
