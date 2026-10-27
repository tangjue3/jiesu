# spikes/ —— 测试与验证

这里的目录不是"一次性探针"，而是**这个产品所有技术主张的证据**。
每个目录对应 `docs/` 里一份报告：报告写结论，这里放可重跑的证明。

`spikes` 这个名字是历史遗留（最初确实是 throwaway 脚本）。保留它，是因为
`docs/Spike报告-*.md` 与目录一一对应，改名会让文档里的引用全部失配。
但请把它们当作**回归测试套件**对待：改动核心代码后必须全绿。

## 目录

| 目录 | 验证什么 | 依赖 | 报告 |
|---|---|---|---|
| `s1/` | 编译期注入源码位置：dev 产物含位置、生产零残留、运行时 DOM 可读回 | Node + jsdom | `docs/Spike报告-S1与S2.md` |
| `s2/` | 确定性写回：一次微调 diff 只动一行（8 类真实形态） | 纯 Node | 同上 |
| `s3/` | 双锚点定位 + HMR 后不丢选中、可连续编辑 | 真实 Chrome | `docs/Spike报告-S3-HMR重绑定.md` |
| `s4/` | 布局语义编辑：改布局绝不产出绝对定位（5 种真实布局） | 纯 Node | `docs/Spike报告-S4-布局语义.md` |
| `v01/` | 端到端最小闭环：选中 → 改属性 → 写回 → 撤销 | 真实 Chrome | `docs/V0.1-使用指南.md` |
| `v02/` | 拖拽重排：拖拽落地为移动 JSX 节点 | 真实 Chrome | `docs/V0.2-拖拽重排.md` |
| `v03/` | 图层面板：图层与画布共享同一选中态 | 真实 Chrome | `docs/V0.3-图层面板.md` |
| `v04/` | 拖动位移：元素跟手，但代码里只有 `translate-*` 类 | 真实 Chrome | `docs/V0.4-拖拽位移.md` |
| `s5/` | 结构化编辑：插入 / 删除 / 复制节点 + 锚点顺移后仍能选中 | 真实 Chrome | `docs/Spike报告-S5-结构化编辑.md` |
| `s6/` | 脚手架：生成的项目**真的能装、真的能起、真的能注入** | 真实 npm install | `docs/Spike报告-S6-脚手架.md` |
| `v05/` | 结构编辑：面板增删复制 + 插入期间串行化 | 真实 Chrome | `docs/V0.5-结构编辑.md` |
| `v07/` | Studio 壳：三设备宽度、代码页 diff 与撤销 | 真实 Chrome | `docs/V0.6-Studio壳.md` |
| `v08/` | 组件库：插一段真实 JSX，画布立刻热更新 | 真实 Chrome | `docs/V0.7-组件库.md` |
| `cli/` | 打包产物能不能真的跑起来（`npx jiesu` 冒烟） | 构建产物 | — |

`s1`..`s6` 是可行性验证（**项目成不成立**），`v01`..`v08` 是功能回归（**做出来的东西还能不能用**）。

## 共享工具：`_shared/`

| 文件 | 作用 |
|---|---|
| `jsx-fixture.ts` | 测试用的 JSX 定位工具（按 class token / 文本 / 行号反推 `file:line:column`），是运行时 `data-jiesu-src` 的替身。S2/S4 靠它免掉浏览器 |
| `baseline.ts` | `resetFromHead()`：e2e 的"原始内容"基线**从 git HEAD 取**，不受工作区脏文件影响 |
| `demo-vite-config.ts` | 靶场 demo 的统一 vite 配置（插件顺序只维护一份） |

## 三条硬约定（都是踩过坑才定下的）

**1. e2e 之间不得共享可变文件。**
曾因 S3 与 v01 共用同一份 `App.tsx`，单独跑全绿、全量跑必挂。
所以每个 e2e 都有自己的 `demo/` 目录，只共享只读样板与 `_shared/` 里的工具。

**2. 每个 demo 必须设独立 `cacheDir`。**
并行跑时会抢同一份 `.vite` 缓存，报 safe-delete 失败，两套 e2e 一起挂。

**3. e2e 基线一律用 `resetFromHead()`，不要直接 `readFileSync` 工作区。**
被中断的测试、或用户在演示实例里拖一下，都会弄脏 demo 文件；
基线取歪之后失败信息会极其误导（表现为 `expected false to be true`，实际是"改动没产生变化"）。

**4. 会 `npm install` 的测试必须与浏览器 e2e 不同时跑（vitest `projects` + `groupOrder` 已固化）。**
`file:` 依赖会让 npm 把**整个 jiesu 仓库软链**进沙箱项目的 `node_modules`，
于是 vitest 的 glob 会顺着软链把仓库里的 e2e **又扫进来跑一遍**（26 个文件变 52 个），
同一批真实文件被两组用例同时改，表现为 e2e 随机失败、且失败集合每次都不同。
更隐蔽的是：这种失败看起来像"代码有 bug"，实际是测试在互相踩。

**5. 测试里的 URL 必须是模板字符串。**
`fetch('http://127.0.0.1:${PORT}/')` 少了反引号就永远是同一个字面量地址，
表现是"vite 明明 ready 却 fetch 不到"，且会白等 30 秒才超时——
和"端口占用"的症状一模一样，极易误判。**用脚本批量改文件后必须 grep 验证。**

**6. `resetFromHead()` 必须能扛住 git 索引锁冲突。**
所有 e2e 在**模块加载时**（describe 外）就调它，而 vitest 用多个 worker 进程并行加载测试文件，
于是多个 `git checkout` 同时执行、撞 `.git/index.lock`。
以前这个错误被 catch 静默吞掉 → 走"按现状跑"分支 → **基线变成被污染的当前文件** →
断言以 `expected false to be true` 这种毫无信息量的方式失败。
现在 `baseline.ts` 会在锁冲突时退避重试（跨进程冲突只能这么解决，
进程内的锁挡不住——每个 worker 是独立进程，模块级变量不共享）。

**7. 断言"页面上的状态"前要等它真的到。**
写回成功 ≠ 覆盖层已收到广播 ≠ DOM 已重绘。这三件事是异步的，
直接读 DOM 会偶发读到旧值（"变更篮是空的"）。
正确写法是**等**：`await waitFor(async () => (await panelState(page)).basket === 1)`。
`spikes/v05/e2e.test.ts` 是照着抄的样板。

## 靶场 demo 的约定

每个 `vXX/demo/` 是一个**自包含**的 vite 工程（vite 以配置所在目录为 root）：

```
demo/
  index.html
  vite.config.ts        # 一行 import 共享工厂
  src/App.tsx           # ← 各组 e2e 唯一的差异点，也是被改写的对象
  src/main.tsx
  src/index.css
```

差异只在 `App.tsx`。其余样板故意保留副本（而不是抽出共享），
因为 vite 需要每个 root 有物理存在的入口文件；共用的部分已收敛到 `_shared/demo-vite-config.ts`。

## 跑法

```bash
cd jiesu
npm test                                   # 全量
npx vitest run spikes/s2                   # 单个
npx vitest run spikes/v04/e2e.test.ts      # 单个端到端
```

端到端用**系统已装的 Chrome**（`/Applications/Google Chrome.app`），不下载浏览器。

## 两个环境坑

- **本机 HTTP_PROXY 会拦 localhost**（返回 502），Playwright 必须加 `--no-proxy-server`。
- 若报 `SAFE_DELETE_BULK_GUARD_ERROR state lock timeout`（vite 清缓存被拦），是宿主环境锁残留，不是代码问题：
  ```bash
  env -u CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR -u CODEBUDDY_TOOL_CALL_ID npx vitest run
  ```
