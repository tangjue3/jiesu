# jiesu

面向 AI Coding 用户的可视化前端编辑器内核。

**核心原则：设计即代码，代码是唯一真实来源。**
不做"重新生成一份设计稿再导出代码"，而是**直接改用户的真实源码**——并且改得**确定、可预期、可撤销**。

## 状态

| 能力 | 状态 | 验证方式 |
|---|---|---|
| 元素 → 源码定位（元素级，双锚点交叉校验） | ✅ | dev 注入 / 生产零残留 / 运行时可读回 |
| 确定性写回（diff 只动该动的那行） | ✅ | 8 类真实形态 golden 测试 |
| 布局语义编辑（改布局不写绝对定位） | ✅ | 5 种真实布局 + 写回后安全审计 |
| 本地服务 + 覆盖层 + 变更篮 | ✅ | 真实 Chrome 端到端 |
| HMR 后不丢选中、可连续编辑 | ✅ | 真实 Chrome 端到端 |
| 拖拽重排（移动 JSX 节点） | ✅ | 真实 Chrome 端到端 |
| 图层面板（与画布共享选中态） | ✅ | 真实 Chrome 端到端 |
| 拖动位移（元素跟手，写 `translate-*` 类） | ✅ | 真实 Chrome 端到端 |
| 改宽高 / 边框 / 阴影 / 增删元素 / 组件替换 | ⏳ | 未开始 |
| 跨容器拖拽、组件栈、AI 辅助 | ⏳ | 未开始 |

全量 **151 个用例通过**，`tsc --noEmit` 零错误，`npm run build` 通过。

## 快速上手

```bash
npm install
npm run build

# 一键演示（起编辑服务 + demo 的 vite，Ctrl+C 一起退出）
./scripts/demo.sh                       # 默认 spikes/v04/demo（拖动位移）
./scripts/demo.sh spikes/v03/demo       # 换靶场
PORT=5300 ./scripts/demo.sh             # 换端口
```

打开 `http://127.0.0.1:5273/`，按 `Alt+Shift+J` 进入选择模式。

接到**自己的项目**上：

```ts
// vite.config.ts
import { jiesu } from 'jiesu/vite-plugin';
export default { plugins: [jiesu(), react()] };  // 顺序不能反
```

```bash
npx jiesu          # 启动编辑服务（写 .jiesu/server.json）
npm run dev        # 你的项目照常启动
```

从零开一个项目：

```bash
npx jiesu new my-page --title 我的页面
cd my-page && npm install && npm run dev
```

> jiesu 尚未发布到 npm，生成的项目用的是 `file:` 软链依赖（指向本地 jiesu），
> 因此装完就能跑，但绑死了本机路径。发布后把依赖改回版本号即可，配置文件不用动。

## 目录

```
src/
  core/                      纯 TS 内核，禁止 import 任何 DOM/UI（可脱离浏览器单测）
    locate/jsx-tree.ts       JSX 树遍历 —— 注入与定位共用的唯一真源
    locate/parse.ts          解析 + 双锚点（行号 / 结构路径）交叉校验定位
    write/apply.ts           确定性写回：AST 定位 → 字符区间 splice
    write/tailwind-classes.ts  class token 分类（p-4 / px-4 / text-sm / text-white 互不误伤）
    write/units.ts           px ↔ Tailwind 刻度
    write/translate.ts       位移换算（吸附 4px 网格）
    layout/                  布局语义：族模型 / 前置条件校验 / 重排 / 安全闸
    inject/                  编译期注入 data-jiesu-src 与 data-jiesu-id
    inspect/                 class → 可编辑属性；class → px（当前值来自代码，不来自渲染结果）
  server/                    WebSocket 服务 + 编辑会话（写回 / 撤销 / 路径越界防护）
  client/                    Shadow DOM 覆盖层：选中、属性面板、图层树、拖拽、指纹找回
  vite-plugin/               用户项目里装的 dev 插件
  cli/                       npx jiesu 入口
spikes/                      测试与验证（目录约定见 spikes/README.md）
scripts/
  build.mjs                  打包 dist/（cli + vite-plugin）
  demo.sh                    一键演示
dist/                        构建产物（不入库）
```

## 开发

```bash
npm test              # 全量 151 个用例
npm run e2e           # 只跑端到端（真实 Chrome，用系统已装的浏览器）
npm run typecheck
npm run build
```

## 关键设计约束

1. **AST 只定位、splice 才落地** —— 保证 diff 只动目标那一行，格式 100% 保真。
   不用 recast 全量重印：重印会吃掉模板字面量里 `${` 之后的换行缩进。
2. **改不了就明说** —— 动态 className（`cn()`、条件表达式、模板拼接）一律返回 `unresolved`，绝不猜着改。
3. **绝不猜定位** —— 行号与结构锚点冲突时**一律拒绝**，宁可让用户重新点一次，也不改错元素。
   行号是唯一会因无关编辑（上方加一行）而失效的信号。
4. **发送前从活着的 DOM 重读锚点** —— 任何缓存的行号都会过期，缓存一次就会改错元素。
5. **生产构建零残留** —— 注入只在 dev 生效。
6. **当前值来自代码，不来自渲染结果** —— 面板数值由 class 反推，不依赖 computed style
   （项目没装 Tailwind 时 computed 会骗人）。
7. **布局改动不产出绝对定位** —— 写回后立刻审计，出现 `absolute` / `left-*` 即拒绝。
   `translate-*` 有意放行：它仍在 Flow 里，兄弟照常排版、断点照常生效。
