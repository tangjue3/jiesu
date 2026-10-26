# Spike 报告 · S4 布局语义编辑

> 执行时间：2026-10-26 ｜ 代码：`jiesu/src/core/layout/`、`jiesu/spikes/s4/`
> 结论强度：**已实测**。11 个用例全通过，全量 32/32。

---

## 结论

> **可以在不产出任何绝对定位的前提下，完成真实的布局调整。**

这是全项目最核心的技术主张——传统可视化编辑器"拖到哪就写 `left/top`"的做法会破坏响应式，而布局语义编辑改的是**布局本身**（flex 方向、对齐、分布、网格跨度、gap），产物天然响应式。

---

## 一、四个设计支点

### 1. 族（family）模型：一个布局属性 = 一个类族

改写时**只动同族的一个 token**，其余逐字节保留。

| 族 | Tailwind 类 | 示例操作 |
|---|---|---|
| flex 方向 | `flex` / `flex-row` / `flex-col` / `flex-row-reverse` / `flex-col-reverse` | row → column |
| 交叉轴对齐 | `items-start` … `items-baseline` | start → center |
| 主轴分布 | `justify-start` … `justify-evenly` | between → evenly |
| gap | `gap-*` / `gap-x-*` / `gap-y-*` | 16px → 24px |
| 网格列数 | `grid-cols-N` | 3 → 2 |
| 网格跨度 | `col-span-N` / `col-start-N` / `col-end-N` | 7 → 8 |
| 排序 | `order-N` | — |

> 注意 `flex` 与 `flex-row` 语义等价，归入同一族；目标是 row 时**保持 `flex` 不动**，避免无意义 diff。

### 2. 前置条件校验：改不了就明说

| 情况 | 行为 |
|---|---|
| 元素不是 flex 容器，却要改 flex 方向 | 拒绝：「该容器当前不是 flex 布局（display: other），无法调整 flex 属性」 |
| 父容器不是 grid，却要改网格跨度 | 拒绝：「父容器不是 grid 布局，网格属性不适用」 |
| 父容器布局未知（UI 层没给上下文） | 拒绝：「无法确定父容器是否为 grid 布局」 |
| 容器没设置过对齐方式 | 拒绝擅自新增：「该容器当前没有设置交叉轴对齐，已拒绝擅自新增」 |

> 「拒绝擅自新增」是刻意设计：加一个 `items-center` 到一个从没设置过对齐的容器，看起来无害，但它可能与既有布局冲突，且用户没要求过。

### 3. 安全闸：绝对定位黑名单

写回后立即审计产物，一旦出现 `absolute` / `fixed` / `left-*` / `top-*` / `inset-*` / `position:` / `translate` / `zIndex` 立刻**拒绝这次改动**。即便上游逻辑出 bug，这道闸也拦得住。

### 4. 结构级操作：移动 JSX 节点，而不是加 `order-N`

调整 flex 子项顺序有两条路：

- **加 `order-N` 类**：简单，但文档顺序与视觉顺序脱节 → 无 JS 场景、SSR、读屏顺序全都错
- **移动 JSX 节点**：改变真实文档顺序 → 正确做法

实现上有个巧思：**空白段固定不动，只把子项按新顺序填回原槽位**。于是缩进与换行结构 100% 保留，不需要任何重新缩进逻辑。

```tsx
// 之前
<div className="flex min-h-screen">
  <aside className="w-64 …" />
  <main className="flex-1 p-6" />
</div>
// 之后（缩进完全不变，没有引入 order 类）
<div className="flex min-h-screen">
  <main className="flex-1 p-6" />
  <aside className="w-64 …" />
</div>
```

同时拒绝「容器内含实际文本内容」时的重排——那会改变语义。

---

## 二、验证覆盖（5 种真实布局 + 11 个用例）

| 靶场 | 操作 | 断言重点 |
|---|---|---|
| 导航栏 | flex 方向 row → column | 只改目标容器，内部另一个 flex 容器不动；无绝对定位 |
| 导航栏 | flex 方向 → row | `flex` 与 `flex-row` 等价，不做无意义改写（changed=false） |
| 卡片网格 | `grid-cols-3` → `grid-cols-2` | 其它 class token 集合完全一致 |
| 表单 | gap 16px → 24px | px 语义 → `gap-6`；`gap-2` 等其它 token 不受影响 |
| Hero | `col-span-7` → `col-span-8` | 网格语义改写，无绝对定位 |
| 侧边栏 | 子项重排 | main 排到 aside 之前；未引入 order 类；缩进保持 6 空格 |
| 导航栏 | grid 属性（父是 flex） | 拒绝并说明原因 |
| 导航栏 | grid 属性（父未知） | 拒绝并说明原因 |
| 表单 | 未设置对齐的 flex 容器改对齐 | 拒绝擅自新增 |
| Hero | `md:grid-cols-6` → `md:grid-cols-4` | **只动 md 断点**，`grid-cols-12` 原样保留 |
| 侧边栏 | 非法排列 `[0,0]` | 拒绝并说明「重复序号」 |

每个用例都跑一遍统一断言：**产物中绝不出现绝对定位类或绝对定位样式**。

---

## 三、过程中修掉的两个真 bug

1. **同族多余 token 的删除偏移算错**——替换首个子串后长度变化，后续用 `out.length` 去算区间就错位了，会连带删掉别的类。改为「先从后往前删、再替换首个」。
2. **网格属性的前置条件搞反**——`col-span` 是**子项**属性，要求的是「父容器是 grid」；我一开始写成了「自身是 grid 容器」，导致合法操作被拒。

---

## 四、这套能力意味着什么

| 传统做法 | jiesu 的做法 |
|---|---|
| 拖拽 → 写 `position:absolute; left:xx; top:yy` | 拖拽 → 改 `flex-direction` / `order` / `col-span` / `gap` |
| 移动端全部错位 | 响应式天然保持 |
| 用户要自己善后 | 产物即正确代码 |

这也是**竞品难以快速复制**的部分：Replit 只提供了 Flex 的基础控件（direction / align / justify / gap），Grid 跨度、断点归属、**结构级重排**都没人做透——而这三样恰好是"设计即代码"最难替代人工的部分。

---

## 五、下一步

- **S3（HMR 后重新选中）**：需浏览器环境。已知有利条件——写回是**同行替换**，行号稳定，可用「组件栈 + 同类索引」做二级定位。
- **V0.1 外壳**：覆盖层 UI + 属性面板 + 变更篮。内核（定位 / 写回 / 布局）已就绪。
