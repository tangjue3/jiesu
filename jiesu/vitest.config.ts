import { defineConfig } from 'vitest/config';

/**
 * 测试配置：把「会 npm install 的慢测」与「浏览器 e2e」分开跑。
 *
 * 根因（实测出来的，不是推测）：
 * `spikes/s6/installable.test.ts` 会真的跑一次 `npm install`。它生成的项目用
 * `file:/绝对路径` 依赖 jiesu，于是 npm 把**整个 jiesu 仓库软链**进沙箱项目的
 * `node_modules/jiesu`。这带来两个后果：
 *
 *  1. vitest 的 glob 顺着软链把仓库里的 e2e 又扫进来跑一遍
 *     （路径形如 `spikes/s6/.sandbox-install/installable/node_modules/jiesu/spikes/v08/e2e.test.ts`），
 *     26 个测试文件变 52 个——同一批真实文件被两组用例同时改，
 *     表现为 e2e 随机失败、失败集合每次都不同，看起来像"代码有 bug"。
 *  2. 即使 exclude 掉副本，npm install 与 e2e 同时跑仍会让 e2e 挂
 *     （实测：把慢测里"起 vite"那步去掉仍然失败；用纯 CPU 负载压测 e2e 却不会）。
 *
 * 所以修法是**让它们不同时跑**，而不是去猜哪一寸资源被抢了。
 *
 * `sequence.groupOrder` 的语义（vitest 3.x）：
 *  - 数字小的组先跑，相同数字的组并行
 *  - 不设则所有 project 全部并行
 * 于是：core 组（纯逻辑 + 浏览器 e2e）先跑完，slow 组（真 npm install）收尾。
 */
export default defineConfig({
  test: {
    projects: [
      {
        // 常规测试：纯逻辑 + 浏览器 e2e
        test: {
          name: 'core',
          include: ['spikes/**/*.test.ts'],
          exclude: [
            'spikes/s6/installable.test.ts',
            // 沙箱里的软链副本会把整个仓库再带进来（含它自己的 e2e），
            // vitest 会把那些文件也当测试跑一遍 —— 于是同一批真实文件被两组用例同时改，
            // 表现为 e2e 随机失败（"变更篮"读不到记录）。
            '**/.sandbox*/**',
            '**/node_modules/**',
          ],
          groupOrder: 0,
          // e2e 的 afterAll 要关掉真实 Chrome + 真实 vite server，
          // 并行跑时偶尔超过默认的 10 秒 → 报 "Hook timed out"。
          // 那是清理超时、不是断言失败，但会让整轮显示为失败。
          hookTimeout: 30_000,
        },
      },
      {
        // 慢测：要真跑 npm install，必须独占资源
        test: {
          name: 'slow',
          include: ['spikes/s6/installable.test.ts'],
          exclude: ['**/.sandbox*/**', '**/node_modules/**'],
          groupOrder: 1,
        },
      },
    ],
  },
});
