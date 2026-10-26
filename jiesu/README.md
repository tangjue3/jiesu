# jiesu

面向 AI Coding 用户的可视化前端编辑器内核（V0.1 验证阶段）。

**核心原则：设计即代码，代码是唯一真实来源。**
不做"重新生成一份设计稿再导出代码"，而是**直接改用户的真实源码**——并且改得**确定、可预期、可撤销**。

## 当前状态

| Spike | 目的 | 状态 | 结论 |
|---|---|---|---|
| **S2** | AST 确定性写回（"改得准"） | ✅ 通过 | 15/15 用例；diff 严格只落在一行 |
| **S1** | 编译期定位注入（"找得到"） | ✅ 通过 | dev 产物含位置属性，生产构建零残留，DOM 可直接读回 |
| S3 | HMR 后重新选中 | ⏳ 未开始 | 需要浏览器环境 |
| S4 | 布局语义不写坏 | ⏳ 未开始 | 纯 Node 可做 |

详见 `../docs/Spike报告-S1与S2.md`。

## 目录

```
src/
  core/                  纯 TS 内核，禁止 import 任何 DOM/UI
    locate/parse.ts      源码解析 + 元素定位
    write/               写回（tailwind-classes / units / apply）
    inject/              编译期源码位置注入
  vite-plugin/           用户项目里装的 dev 插件
spikes/
  s1/                    定位注入验证（含 demo 工程）
  s2/                    确定性写回验证（含 golden fixtures）
fixtures/                golden 测试靶场：original / expected 配对
```

## 开发

```bash
npm install
npm test          # 全部 21 个用例
npm run s2        # 只跑 S2
npm run typecheck
```

## 关键设计约束

1. **AST 只用来定位，落地靠源码 splice**——保证 diff 只动目标那一行，格式 100% 保真。
2. **改不了就明说**——动态 className（`cn()`、条件表达式）一律返回 `unresolved`，绝不猜着改。
3. **写回前必须先产出变更计划**——禁止直接写文件，这是撤销 / diff / 批量应用 / AI 兜底的唯一支点。
4. **生产构建零残留**——注入只在 dev 生效。
