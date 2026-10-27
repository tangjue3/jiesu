# S6 脚手架：把「创建空白画布」落成真实项目

> 画布路线的前提：一张新画布必须先是**磁盘上真实可跑的项目**，
> 否则画布上拖的东西没有"代码是唯一真实来源"可言（那就变成 JSON 文档 + codegen 了）。
>
> 结论：`jiesu new my-page` 能生成一个装完依赖即可 `npm run dev` 的 Vite + React + TS + Tailwind v4 项目，
> 且已带 jiesu 插件——用户不必自己改 `vite.config.ts`。
> 验证：`spikes/s6` 10 个用例 + 全量 187/187 通过。

## 一、怎么用

```bash
npx jiesu new my-page --title 我的页面
cd my-page
npm install
npx jiesu        # 另开终端，起编辑服务
npm run dev      # 打开页面后按 Alt+Shift+J
```

生成 9 个文件：

```
my-page/
  package.json      react19 + vite7 + tailwind4 + jiesu
  vite.config.ts    plugins: [jiesu(), react(), tailwindcss()]   ← 顺序有讲究
  tsconfig.json
  index.html
  src/main.tsx
  src/App.tsx       一张有内容的起始页（不是空白页）
  src/index.css     @import 'tailwindcss'
  .gitignore
  README.md
```

`src/App.tsx` 故意不生成空白文件：一进去就有标题、说明、两张卡片，
这样"选中 → 改 → 看效果"这条链路第一次就能走通。

## 二、两层拆分

| 层 | 文件 | 职责 | 为什么这样切 |
|---|---|---|---|
| 模板层 | `src/core/scaffold/templates.ts` | 纯函数：项目名 → 文件清单 | 不碰磁盘，可脱离文件系统单测；内核不依赖 IO 顺序 |
| 落盘层 | `src/server/scaffold.ts` | 校验 + 写文件 | 所有"会不会覆盖别人东西"的判断集中在一处 |

**绝不覆盖**是这里最重要的规则，且做了两道：

1. 目标目录已存在且非空 → 直接拒绝，并说出有几项内容
2. 任何一个目标文件已存在 → **整体放弃**，不写任何文件

第二条是为了不留下"半个项目"——半成品比失败更难排查。

## 三、两个真 bug（这一版最大收获）

### ① 发布形态下覆盖层拿不到（页面会白屏）

插件原来的 `load()` 这么做：

```ts
buildSync({ entryPoints: [new URL('../client/index.ts', import.meta.url).pathname] })
```

从源码跑（vitest、`tsx`）时它指向 `src/client/index.ts`，没问题。
但插件被打包后 `import.meta.url` 落在 `dist/vite-plugin/`，那里**没有** `src/client/index.ts`，
现场编译直接抛错——页面白屏。更糟的是所有测试都绿：它们只请求了 `index.html` 和 `App.tsx`，
从来没有请求过覆盖层那个虚拟模块。

修法：

- `build.mjs` 增加第三个入口，预先把 `dist/client/overlay.js` 打好
- 插件 `load()` **优先读产物**，读不到（从源码跑）才现场编译 TS
- `spikes/s6` 里新增断言：真的 `fetch('/@id/__x00__jiesu-client')`，要求 200 且包含 `data-jiesu-overlay`

> 这是本项目第二次踩"只测源码、不测产物"的坑（上一次是 `npx jiesu` 的 shebang 写了两遍）。
> 已经形成规矩：**凡是发布形态的能力，必须有真跑产物的测试**。

### ② 插入后串行化不够严，客户端会选中"被挤走的那个元素"

v05 的端到端一开始通过，后来稳定失败。查下来是一条很隐蔽的链：

```
插入前：  0.0.2.0 = 第一块   0.0.2.1 = 第二块
插入后：  0.0.2.0 = 第一块   0.0.2.1 = 新按钮   0.0.2.2 = 第二块
```

服务端回传的 `select.anchor = 0.0.2.1` 是对的。但客户端**在 HMR 之前**就去 DOM 里查
`[data-jiesu-id$="#0.0.2.1"]`，这时命中的是**旧的第二块**（DOM 还没更新），
于是立刻"找到了"，锁提前解开——用户接着的编辑就打在了第二块上。

更麻烦的是这个例子里新旧元素的行列号恰好相同（都是第 9 行），
光靠 `data-jiesu-src` 也区分不开。

修法是两道门槛同时满足：

1. **先等一次结构性变动**（`MutationObserver` 的 childList）——证明 React 真的重建了 DOM
2. **锚点 + 源码行列双匹配**——两者都吻合才算找到

找不到就明说"页面还没更新到位，请重新选择"，绝不把选中态留在可能被别人占用的位置。

## 四、当前限制

| 限制 | 说明 |
|---|---|
| 不自动 `npm install` | 生成文件后由用户执行（不在内核里跑包管理器） |
| 本地开发版依赖绑死本机 | jiesu 未发布，生成的项目写 `file:/绝对路径` 软链依赖；发布后改回版本号即可（配置不用动） |
| 只有一个起始页模板 | 没有"空白/博客/落地页"等多模板选择 |
| 不初始化 git | 只写了 `.gitignore` |
| 目录必须为空 | 不做"在已有目录里补充脚手架" |

## 五、S6 补强：让生成的项目真的能装能跑（2026-10-27）

> 上面那句「本地验证时用绝对路径引用 dist/vite-plugin/index.js」曾经是个**已知缺口**：
> 生成的项目 `npm install` 会直接失败，所以「创建项目 → 装依赖 → npm run dev」
> 这条最基本的链路是断的。而所有测试都绿——因为它们只断言"文件写对了"，
> 没人真的装过一遍。这已经是本项目第三次踩「只测源码、不测产物」的坑。

### 三个真问题

| 问题 | 症状 | 根因 |
|---|---|---|
| `exports` 缺子路径 | `import { jiesu } from 'jiesu/vite-plugin'` 解析失败 | package.json 只导出了 `"."`，没导出 `"./vite-plugin"` |
| 版本号漂移 | 声明 `^0.5.0`，实际包版本 `0.1.0`，npm 上根本没有 | 模板层硬编码版本字符串，与 package.json 各写各的 |
| 依赖指向不存在的包 | `npm install` 报 `No matching version found for jiesu` | jiesu 未发布，却写了版本号依赖 |

### 修法

**① 依赖声明只有一个真源。** 模板层（纯函数、不碰磁盘）不再持有版本号，
改由 `src/server/plugin-ref.ts` 解析后传入——它按**当前 jiesu 的真实安装形态**判断：

| 场景 | 判据 | package.json | vite.config.ts |
|---|---|---|---|
| 本地开发 | 包目录不在 `node_modules` 下 | `file:/绝对路径` | `jiesu/vite-plugin` |
| npm 发布后 | 包目录在 `node_modules` 下 | `^<真实版本>` | `jiesu/vite-plugin` |

**② 为什么本地模式用 `file:` 而不是把绝对路径写进 vite.config.ts？**
`file:` 会被 npm 装成软链，**import 标识符保持 `jiesu/vite-plugin`**——
和发布后一模一样。将来发布时只要改依赖字符串，配置文件一行都不用动。

**③ 代价要说清楚**：本地模式的项目绑死本机路径，不能直接分享。
所以生成项目的 README 里会写明这一点，CLI 输出也会提醒。

### 验证（不是"我觉得能跑"）

新增 `spikes/s6/installable.test.ts`，判据是**真跑**：

- `npm install` 真装完（82 个包）
- `import('jiesu/vite-plugin')` 真能解析出 `jiesu` 函数
- vite 真起来，`__JIESU_PORT__` 注入到位、10 处 `data-jiesu-src` 就位、覆盖层 200

**并且验证过这个测试能抓住 bug**：把依赖故意改回 `^0.5.0` → 3 个用例失败
（依赖声明断言 / npm install 断言 / 引用解析断言），改回后重新变绿。

## 六、连带挖出三个真 bug（都不是测试问题，是产品代码的问题）

新测试进了测试套件之后，全量跑开始**随机失败**（失败集合每次都不同）。
排查过程比修复本身更值得记：

### ① 覆盖层在 WebSocket 未连上时**静默丢弃**用户的操作（产品 bug，最严重）

```ts
private send(message: ClientMessage): void {
  if (this.ws?.readyState === WebSocket.OPEN) {   // ← 不满足就什么都不做
    this.ws.send(JSON.stringify(message));
  }
}
```

**真实场景**：页面刚打开，用户手比网络快，第一下操作就没了——不报错、不提示、
页面上什么也没变。用户只会觉得"这编辑器时灵时不灵"。

**修法**：未就绪时把消息**排队**，连接建立后补发。
但选中态是"状态快照"，只有最新那份有意义，排队补发一串过时的选中态会让
Studio 显示一个早就取消的选中目标（**插入位置错一次就是改错元素**），
所以快照走单独的 `sendSnapshot()`：同类型只保留最新一条。

顺带补上**断线重连**（服务重启后页面不该变成"僵尸"：能看不能改）与
`pagehide` 时的清理（避免在 bfcache 里留一串重连定时器）。

### ② `git checkout` 跨进程冲突 → 基线被污染（测试基础设施 bug）

所有 e2e 在**模块加载时**就调 `resetFromHead()`，而 vitest 用多个 worker 进程并行加载
测试文件 → 多个 `git checkout` 同时执行 → 撞 `.git/index.lock`：
除了一个成功，其余全部 `fatal: Unable to create index.lock`。

这个错误以前被 catch **静默吞掉**，于是走"按现状跑"分支，
**返回被污染的当前文件而不是 HEAD 基线** → 断言以
`expected false to be true` 这种毫无信息量的方式失败。

进程内的锁挡不住（每个 worker 是独立进程，模块级变量不共享），
真正的修法是**退避重试**——冲突是短暂的。

### ③ `file:` 软链把整个仓库带进沙箱 → vitest 把仓库里的 e2e 又跑了一遍

`file:` 依赖让 npm 把 jiesu 仓库软链进沙箱项目的 `node_modules/jiesu`，
vitest 的 glob 顺着软链把仓库里的 e2e **又扫进来**（26 个文件变 52 个），
同一批真实文件被两组用例同时改。

修法：`vitest.config.ts` 用 `projects` + `groupOrder` 把「会 npm install 的慢测」
与「浏览器 e2e」分开跑（慢测 groupOrder=1，收尾跑），并 exclude 掉软链副本。

### 一个必须记住的教训

**"随机失败、失败集合每次都不同"几乎不是代码问题，是测试在互相踩。**
这次排查花的时间比写修复长得多，中途还差点改错方向（怀疑端口冲突、怀疑 CPU 争抢）。
判断依据应该是**对照实验**：单独跑通过 + 全量跑失败 → 一定是并发问题；
纯 CPU 负载压测仍通过 → 不是算力，是共享状态。

## 七、下一步

- **组件库页面**：把 `COMPONENT_TEMPLATES` 变成可搜索、可预览、可拖的界面
- **Studio 壳**：72px 左导航 + 60px 顶栏 + 画布页（真实 iframe + 三设备宽度），先只做 02 与 07 两页接真实数据
