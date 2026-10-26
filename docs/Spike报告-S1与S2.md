# Spike 报告 · S1 与 S2

> 执行时间：2026-10-26 ｜ 代码：`jiesu/spikes/` ｜ 测试：21/21 通过
> 结论强度：**已实测**（非推断）。本报告修正了此前方案中的两处关键判断。

---

## 摘要：两个 Spike 各自证明了什么

| Spike | 命题 | 结果 |
|---|---|---|
| **S2** | 「一次可视化微调，可以只改动目标那一行，其余字节完全不动」 | ✅ **成立**。8 个真实形态的靶场全部产出与人工预期逐字节相同的结果，diff 严格单行 |
| **S1** | 「DOM 上能拿到元素的源码位置（元素级）」 | ✅ **成立**，但**路径与原设想不同**——必须自己做编译期注入 |

**项目成立性判断：两个最关键的技术假设都已验证。** 剩下的 S3 / S4 属于工程实现与产品打磨，不再是"能不能做"的问题。

---

## 一、S2 · 确定性写回

### 结论

> **AST 只用于定位，最终落地是源码字符区间的精确替换（splice）。**

这是本次 Spike 最重要的产出，也是对原方案的**实质性修正**。

### 为什么不用「改 AST 再整体打印」

原计划用 recast 打印。实测发现两个问题：

1. **模板字面量会丢格式**——recast 重印 `className={\`...\`}` 时，`${` 后的换行与缩进（不属于任何 AST 节点）会消失，diff 从 1 行变成多行；
2. **打印行为依赖 printer 实现细节**，不同节点（StringLiteral / TemplateElement / JSXText）的引号与转义处理各不相同，难以保证"只动该动的那一行"。

改用 splice 后，格式保真变成**结构性保证**而非"祈祷 printer 听话"。

### 探针实测：babel 节点的字符区间精确可用

```
StringLiteral    [52,68]   slice="\"p-4 text-white\""     ← 含引号，区间精确
StringLiteral    [87,93]   slice="'16px'"                  ← inline style 值
JSXText          [146,151] slice="hello"                   ← 文本节点
TemplateElement  [122,127] slice="px-3 "                   ← 模板静态段，不含 ${}
```

### 验证过的 8 类形态

| 靶场 | 形态 | 结果 |
|---|---|---|
| f1 | 静态 `className="…"` | ✅ 改 `p-4`→`p-6`，其余类不动 |
| f2 | 跨行模板字面量 | ✅ 改 `px-3`→`px-4`，**内部换行与缩进逐字节保留** |
| f3 | `cn()` 调用 | ✅ **明确拒绝**（unresolved），不猜 |
| f4 | 条件表达式 | ✅ **明确拒绝** |
| f5 | 多实例（改使用处） | ✅ 只改第一个实例，组件定义与其它实例零变化 |
| f6 | inline style 对象 | ✅ `padding: '16px'`→`'24px'`，保留单引号 |
| f7 | JSX 文本节点 | ✅ 直接替换 |
| f8 | 同类别多类（`p-2 px-4 py-1`） | ✅ 只动 `p-2`，`px-4`/`py-1` 不动 |

外加 4 个分类器 / 单位换算用例（`text-sm` 是字号不是颜色、`text-white` 是颜色不是字号、px↔Tailwind 刻度互转、13px 无法映射时拒绝）。

### 实现要点（值得固化为规范）

1. **token 级替换而非字符串级替换**——用正则按 `\S+` 切分 token，逐个判定、只替换命中的，其余空白原样保留。字符串级 replace 会毁掉模板字面量里 `${` 前的空格（`text-xs ${x}` 变成 `text-xs${x}` → 样式直接坏掉）。
2. **px → Tailwind 类必须带"类族前缀"**——`p` / `px` / `gap` 各自成族。`classByPx` 操作必须同时给出 `fromPx` 与 `toPx`（旧值来自面板显示的 computed style），否则无法区分 `p-4` 与 `px-4`。这是第一版 API 设计缺陷，已修正。
3. **按类别 + base 双重匹配**——避免 `p-4` 误伤 `px-4`、`text-sm` 误伤 `text-white`。

---

## 二、S1 · 定位注入

### ⚠️ 结论修正：React 19 彻底丢弃了源码位置

原方案（L0：读 fiber `_debugSource`，零配置）**在 React 19 下不成立**。实测（React 19.3.1，jsdom）：

```
host fiber._debugSource            : null        ← 已移除
host fiber._debugInfo              : null
host fiber.memoizedProps.__source  : null        ← props 里也没有
composite fiber._debugStack         : "Error: react-stack-top-frame"  ← 无用
```

顺带查明：`@vitejs/plugin-react` **确实在 dev 下发射了 source**（产物里 `jsxDEV("div", {...}, void 0, false, { fileName, lineNumber, columnNumber }, this)`），**但 React 19 直接把它丢了**——即 React 19 环境下这些 source 信息是白烧的。

另外确认：纯 esbuild 的 `jsxDev: true` **不发射 source**（`__source` 与 source 都没有），所以"零配置"在 esbuild 管线下同样不成立。

### 修正后的方案：编译期注入 DOM 属性

既然运行时拿不到，就自己注入。在 JSX 标签上直接写进位置：

```jsx
// 用户源码
<div className="p-4 text-white">

// dev 管线产物
jsxDEV("div", { "data-jiesu-src": "src/Card.tsx:3:4", className: "p-4 text-white", ... })
```

**为什么这个方案比原设想更好**：
- 元素级精度（不是组件级）
- 完全不依赖 React 内部 API，跨 React 版本稳定
- DOM 上直接可读，UI 层零成本获取
- 不需要拦截 `react/jsx-dev-runtime`（那是对预打包产物的文本篡改，很脆）

### 验证结果

| 验证项 | 结果 |
|---|---|
| 注入函数（golden） | ✅ 每个 JSX 元素都注入；除插入外原代码逐字节不变 |
| 组件标签 / 自闭合标签 | ✅ `<Foo.Bar data-jiesu-src="…">`、`<br data-jiesu-src="…">` |
| Vite dev 真实管线 | ✅ `transformRequest('/src/Card.tsx')` 产物含 `"data-jiesu-src": "src/Card.tsx:3:4"` |
| **生产构建** | ✅ `vite build` 产物中**零注入、零 jiesu 痕迹**（插件 `apply: 'serve'`） |
| **运行时读回** | ✅ jsdom 渲染后 `element.getAttribute('data-jiesu-src')` 拿到 `Card.tsx:3:4` |

> 运行时读回是**痛点①「找不到元素在哪」**的最终判据——它通过了。

### 注意事项

1. **插件顺序**：必须 `plugins: [jiesu(), react()]`。若顺序反了，JSX 已被编译，注入器会检测到 `jsxDEV(` 并报 `tooLate`，插件发出警告提示调整顺序（已实现，不会静默失败）。
2. **DOM 噪音**：dev 模式下每个元素多一个 `data-jiesu-src` 属性。影响面：DOM 快照测试会多出属性（dev only）；自定义组件会收到这个 prop（一般无影响，但严格校验 props 的组件需要留意）。
3. **sourcemap**：注入用 magic-string 生成 map，不破坏用户项目的调试链路。

---

## 三、被修正的判断（存档，避免以后走回头路）

| 原判断 | 实测结论 |
|---|---|
| React 19 可从 fiber 读 `_debugSource` | ❌ 已移除；`_debugStack` 只有无用占位；`props.__source` 也不存在 |
| 用 recast 改 AST 后打印即可保住格式 | ❌ 模板字面量会丢换行缩进，diff 从 1 行变多行 |
| `classByPx` 只需目标 px | ❌ 必须同时知道旧值（`fromPx`）与类族前缀，否则会误伤 `px-4` |
| 纯 esbuild 管线也能拿到 source | ❌ esbuild `jsxDev` 不发射 source |

---

## 四、下一步

| 项 | 内容 | 备注 |
|---|---|---|
| **S3** | 写回后（HMR）如何重新选中原元素 | 需浏览器；写回是同行替换 → 行号稳定，可用"组件栈 + 同类索引"做二级定位 |
| **S4** | 布局语义编辑：改 flex direction / order / grid span，**断言产物不含 `position:absolute`** | 纯 Node 可做；这是壁垒所在 |
| **V0.1** | 覆盖层 UI + 属性面板 + 变更篮 | 依赖 S1/S2 的内核已就绪 |
