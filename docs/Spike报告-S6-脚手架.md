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

生成 10 个文件：

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
| 依赖线上 npm | `jiesu` 尚未发布，本地验证时用绝对路径引用 `dist/vite-plugin/index.js` |
| 只有一个起始页模板 | 没有"空白/博客/落地页"等多模板选择 |
| 不初始化 git | 只写了 `.gitignore` |
| 目录必须为空 | 不做"在已有目录里补充脚手架" |

## 五、下一步

- **组件库页面**：把 `COMPONENT_TEMPLATES` 变成可搜索、可预览、可拖的界面
- **Studio 壳**：72px 左导航 + 60px 顶栏 + 画布页（真实 iframe + 三设备宽度），先只做 02 与 07 两页接真实数据
