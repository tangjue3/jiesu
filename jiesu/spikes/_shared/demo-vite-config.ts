/**
 * 靶场 demo 的统一 vite 配置。
 *
 * 为什么每个 demo 目录还要有自己的 `vite.config.ts`：
 *   vite 以配置文件所在目录为 root，而每个端到端用例必须拥有**独立的 demo 目录**
 *   （否则多组 e2e 会互相改写同一份 App.tsx / 抢同一份缓存，见 docs/V0.3 的踩坑记录）。
 *   所以「目录必须分开」是刻意的，但「配置内容」没必要复制 4 份 —— 收敛到这里。
 *
 * 插件顺序不能调：jiesu 必须在 react() 之前，否则 JSX 已被编译、注入时机太晚。
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

import { jiesu } from '../../src/vite-plugin';

export function demoViteConfig(): UserConfig {
  return {
    plugins: [jiesu(), react(), tailwindcss()],
  };
}
