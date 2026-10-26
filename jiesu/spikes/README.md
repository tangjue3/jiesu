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
| `cli/` | 打包产物能不能真的跑起来（`npx jiesu` 冒烟） | 构建产物 | — |

`s1`..`s4` 是可行性验证（**项目成不成立**），`v01`..`v04` 是功能回归（**做出来的东西还能不能用**）。

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
