# jiesu

面向 AI Coding 用户的可视化前端编辑器内核。

**核心原则：设计即代码，代码是唯一真实来源。**
不做"重新生成一份设计稿再导出代码"，而是**直接改用户的真实源码**——并且改得**确定、可预期、可撤销**。

## 状态

| 能力 | 状态 | 验证方式 |
|---|---|---|
| 元素 → 源码定位（元素级） | ✅ | dev 产物含位置 / 生产零残留 / 运行时可读回 |
| 确定性写回（diff 只动一行） | ✅ | 8 类真实形态 golden 测试 |
| 布局语义编辑（不写绝对定位） | ✅ | 5 种真实布局 + 安全闸 |
| 本地服务 + 覆盖层 + 变更篮 | ✅ | 真实 Chrome 端到端 9/9 |
| HMR 后重新选中 | ⏳ | 待做（S3） |

全量 **46 个用例通过**，`tsc --noEmit` 零错误。

详见 `../docs/Spike报告-S1与S2.md`、`../docs/Spike报告-S4-布局语义.md`、`../docs/V0.1-使用指南.md`。

## 快速上手

```bash
npx jiesu                                    # 启动本地编辑服务
# 在 vite.config.ts: plugins: [jiesu(), react()]
npm run dev                                  # 启动你的项目
# 页面上按 Alt+Shift+J 进入选择模式
```

## 目录

```
src/
  core/                  纯 TS 内核，禁止 import 任何 DOM/UI
    locate/parse.ts      源码解析 + 元素定位
    write/               确定性写回（class 分类 / px↔类 / splice 落地）
    layout/              布局语义（族模型 / 重排 / 安全闸）
    inject/              编译期源码位置注入
    inspect/             class → 可编辑属性 / class → px
  server/                WebSocket 服务 + 变更会话
  client/                浏览器覆盖层（Shadow DOM）
  cli/                   npx jiesu
  vite-plugin/           用户项目里装的 dev 插件
spikes/                  各阶段的验证脚本与靶场
fixtures/                golden 测试靶场：original / expected 配对
```

## 开发

```bash
npm install
npm test          # 全部 46 个用例
npm run e2e       # 端到端（真实 Chrome，用系统已装的浏览器）
npm run typecheck
npm run build     # 打包 dist/
```

## 关键设计约束

1. **AST 只定位、splice 才落地**——保证 diff 只动目标那一行，格式 100% 保真。
2. **改不了就明说**——动态 className（`cn()`、条件表达式）一律返回 `unresolved`，绝不猜着改。
3. **写回前必须先产出变更计划**——禁止直接写文件，这是撤销 / diff / 批量应用 / AI 兜底的唯一支点。
4. **生产构建零残留**——注入只在 dev 生效。
5. **当前值来自代码，不来自渲染结果**——面板显示的数值由 class 反推，不依赖 computed style。
