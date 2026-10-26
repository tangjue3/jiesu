# jiesu

面向 AI Coding 用户的可视化前端编辑器：加载本地真实运行的网页，像设计工具一样编辑布局/样式/内容，并把改动**确定性地写回原始 React 源码**。

核心原则：**设计即代码，代码是唯一真实来源**——不做一次性产物导出，所有编辑最终落到开发者自己的 `.tsx` 文件里。

## 当前状态

研究与技术验证阶段（V0.1 定义完成，尚未开始编码）。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/visual-editor-产品调研与定位.md](docs/visual-editor-产品调研与定位.md) | 竞品格局、赛道判断、差异化候选、技术难点与架构、MVP 边界 |
| [docs/V0.1-技术方案与Spike计划.md](docs/V0.1-技术方案与Spike计划.md) | 定位方案、AST 写回方案、模块划分、Spike 顺序 |

## 技术方向（摘要）

- 目标栈：**React + Vite + Tailwind**
- 定位：编译期注入 `data-jiesu-id`（Vite 插件包装 `jsxDEV`），而非依赖 React 19 已移除的 `fiber._debugSource`
- 写回：`recast` + `@babel/parser`，保留原始格式，diff 只含真正改动的那几行
- 三大痛点各配一个最小能力：元素定位 / 结构化属性面板 / 变更篮（逐条 diff 与撤销）
- 协作模型：单人 + 本地 dev server；回滚兜底依赖 git 工作区干净
