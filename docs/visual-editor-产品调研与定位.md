# AI Coding 可视化前端编辑器｜竞品调研 · 技术可行性 · 定位建议

> 调研时间：2026-10-26 ｜ 证据标记：**【事实】**=可查证的公开信息 ｜ **【推断】**=基于事实的技术/商业判断 ｜ **【假设】**=尚未验证，需实验
>
> 本文目标是帮你做判断，不是给你打气。有几条结论会直接挑战原始构想里的假设。

---

## 0. 先说结论：5 条可能让你不舒服的判断

1. **你列的"核心功能清单"里，第一项（可视化编辑 + 布局/样式/组件增删改）在 2026 年已经不是创新点，是入场券。** Onlook、Replit、Cursor、v0、Subframe 全都有。**【事实】**
2. **赛道整体已经从"确定性写回源码"撤退到"让 Agent 代写源码"。** 最直接的证据：Onlook 自己把主力产品从"浏览器内插桩 + 确定性写回"改成了"Mac 桌面端 + git worktree + Claude Code/ChatGPT 代写 + 发 PR"，官方文档里已经不再提直接拖拽改样式。**【事实】** 这是整个赛道最重要的负面信号，也是你最大的机会窗口。
3. **你的原始痛点（"越改越乱、改局部影响其他区域"）恰恰是 Agent 路线的结构性缺陷，而 Agent 路线正在成为行业默认。** 所以差异化不在"能不能改"，而在**"改得确不确定、能不能预期、能不能撤回来"**。
4. **不要做"又一个编辑器外壳"。** 宿主层（IDE/浏览器/桌面 App）正在被 Cursor、Claude Code、v0、Replit 瓜分，独立产品在这里硬碰硬没有胜算。**【推断】** 应该做**"确定性编辑内核 + 可嵌入任何宿主"**（CLI / MCP / 浏览器扩展 / 桌面 App 四种形态共用同一内核）。
5. **第一版必须砍掉的东西比你想的多**：多框架、组件库替换、Figma 导入、多人协作、AI 圈选改、多设备完整预览。MVP 只做一件事：**"改得准、看得见、撤得回"**。

---

## 1. 竞争格局核查：2026 年 10 月的真实版图

### 1.1 关键玩家对照表

| 产品 | 形态 | 是否改真实仓库代码 | 视觉操作方式 | 谁把改动写进代码 | 价格 | 主要限制 |
|---|---|---|---|---|---|---|
| **Onlook（新版）** | macOS 桌面 App（Electron，Apple silicon） | 是，但在 git worktree 副本上，以 PR 交付 | 画布 + 帧，主要是"聊天提需求 + 草图 artifact" | Claude Code / ChatGPT（用你自己的账号） | 免费（beta） | 只 macOS；Windows/Linux/Intel Mac 仍在 waitlist；**官方文档已不强调直接拖拽改样式** |
| **Onlook（开源老版）** | Web（web container + iframe） | 是，Next.js + Tailwind 项目 | Figma 式直接拖拽/改 Tailwind 类 | **确定性写回**（diff-match-patch + HMR） | 免费自托管 / 托管版需 waitlist | README 自己标注多项未完成：非 Next.js、非 Tailwind、MCP、协作评论、图像参考 |
| **Cursor Design Mode** | Cursor 内置浏览器 | 是 | 点选元素 / 页面圈画 / 语音；多选 | Cursor Agent（推荐 Composer 2.5） | 含在 Cursor 订阅 | 每次视觉改动 = 一次 Agent 编辑（token 成本 & 非确定性）；需本地跑应用 |
| **v0 Design Mode** | Vercel v0 | 是（可导入 GitHub 仓库并发 PR） | 在实时预览里选元素，可视化面板调样式，能识别 Tailwind | v0 Agent | v0 订阅 | 生成型工具起家，对已有大型仓库的适配待验证 |
| **Subframe** | macOS/Windows 桌面 App + 内置浏览器 + Canvas | 是，读写本地文件 | **Inspect 元素 → 改 props/styles/classes/content → Send** | Claude Code / Codex（你自己的订阅）或 Subframe credits | Free（1 项目）/ Pro $20/editor/月 | 视觉改动是"给 Agent 的规格说明"，不是确定性写回；Canvas 到代码是单向同步 |
| **stagewise** | `npx stagewise` 代理本地 dev server，注入工具栏 | 是 | 点元素 + 自然语言；后来出了自带浏览器环境 | 自家 Agent，或转发给 Cursor/Copilot/Windsurf/Cline/Roo/Kilo/Trae | 开源 AGPLv3 | 本质是"丰富上下文 → Agent"，无确定性层 |
| **Replit Visual Editor** | Replit 内（仅 Web 端） | 是 | 点选改文字/颜色/间距；**Flexbox 布局控件**（2026-05 更新） | **简单改动确定性直写源码，不消耗 AI credits；复杂改动交给 Agent** | 含在 Replit | 只能在 Replit 生态内；仅浏览器；复合元素不能改文字 |
| **Builder.io（Builder Code）** | SaaS + SDK | 是，走分支/PR | 可视化 CMS + Visual Copilot（Figma→代码） | 注册组件 + AI | Free / Pro $24 / Team $40 | 组件注册是沉重的工程税；Agent Credits 计费会抑制探索 |
| **Modeinspect** | 私有云 Canvas | 是，以 PR 交付 | 用你自己的组件在画布上改，生成变体 | 云端 Agent | Hobby 免费 / Pro $20 | 只支持 Next.js + Tailwind |
| **Paper / pen.dev** | 设计画布 + MCP | 否（代码由你自己的 Agent 写） | 画布设计，MCP 同步 token/组件 | 你自己的 Agent | 免费档 + $16~20 | 不是编辑器，是画布 + MCP 桥 |
| **Puck / Plasmic / Makeswift** | 库 / 平台 | 否（页面存在它们自己的系统里） | 拖拽页面 | 生成 JSON 或代码 | Puck 免费 MIT | 编辑的是"由你的组件拼出来的内容"，不是你的源码 |
| **chrome-devtools-mcp / Safari MCP** | 官方 MCP server | 不写代码 | Agent 可读取 DevTools 中**被选中的元素** | 你的 Agent | 免费 | 只提供"看"和"操作"能力，无编辑语义层 |

### 1.2 三条你必须知道的时间线事实

- **平台方正在把这件事内建**：Cursor 出了 Design Mode（点选/圈画/语音 → Agent 改码）；Claude Code 在桌面端加入了内置浏览器（媒体称 2026-07-10）；Chrome DevTools MCP 已支持连接已登录的现有会话并感知你手动选中的 DOM 节点（Chrome 144+）；Safari Technology Preview 247（2026-07）也引入了 MCP server。**【事实】**
- **设计工具方向也在双向打通**：Figma 在 2026-03 推出 MCP server 测试版，允许 Claude Code / Codex 等外部 Agent 读写画布（媒体报道，建议二次核实）。**【事实（媒体来源）】**
- **"改得准"的确定性路线几乎没人坚持**：目前公开资料里，只有 **Replit Visual Editor 明确写了"确定性直写、不消耗 AI credits"**，以及 **Onlook 老开源版**做过插桩写回。

### 1.3 对你原文竞品清单的修正

你列的 5 个竞品里，**Onlook 是最强竞品这一条现在要重新表述**：它的开源老版（你构想的原型）已被官方自己降级为"起点项目"，新产品的叙事是"设计师在真实代码上工作 + Agent 代写 + PR"。这意味着：

> **你想做的东西，Onlook 做过、拿到 26k stars、进了 YC W25，然后把主力方向改了。** **【事实】**

这条必须当成核心研究课题：是技术不可行、是商业不可行、还是产品定位不可行？我倾向于是**"技术可行但覆盖不了长尾，导致体验承诺无法兑现"**——也就是**可靠性问题**，不是方向问题。而这恰好是你能改进的地方（见第 4 节）。

---

## 2. 竞品"宣传 vs 实际"拆解

| 宣称能力 | 实际边界（公开信息 + 技术推断） | 证据等级 |
|---|---|---|
| "支持任意 React 项目" | 实际成熟路径都是 **Next.js + Tailwind**。Onlook 开源版 README 自认"非 Next.js/非 Tailwind 支持未完成"；Modeinspect 明说只支持 Next.js+Tailwind | 【事实】 |
| "改完直接同步源码" | 多数是"把你的视觉意图 + 截图 + DOM 上下文打包发给 Agent，由 Agent 写文件"。只有 Replit 对简单改动做了确定性直写 | 【事实】 |
| "组件替换保留业务逻辑" | 没有任何一家公开宣称做到了可靠的"换皮不换逻辑"。组件复用（instanced 元素）只有 Replit 提到"循环渲染/多处复用的元素会一起高亮并一起改"——这恰恰说明**改一处会影响 N 处**是行业默认行为 | 【事实】+【推断】 |
| "响应式安全" | 只有 Replit 提供了语义化的 Flex 控件（direction / align / justify / gap / space-between）。拖拽式编辑器的通病史就是生成绝对定位，破坏响应式 | 【事实】 |
| "不消耗 token / 免费" | Replit 明确区分"确定性改动免费 vs 复杂改动走 Agent"；Subframe 用你自己的 Claude/Codex 订阅；Onlook 新版同样用你自己的账号。**"低 token 成本"已经是行业共识方向，不是你的独有卖点** | 【事实】 |
| "AI 圈选改 / 参考图还原" | 基本都还在"聊天 + 截图"层面。真正可复现的"参考图 → 结构化视觉差异 → 定向修改"未见成熟产品 | 【推断】 |

---

## 3. 对你 6 条创新方向的逐条裁决

| # | 你的方向 | 裁决 | 理由 |
|---|---|---|---|
| 1 | AI Coding 最后一公里 | ✅ **保留为主定位** | 叙事清晰、时机对。但要窄化为"**AI 生成之后的确定性精修**"，不是"再做一个 AI 建站工具" |
| 2 | 独立于 AI 编码平台 | ⚠️ **保留但改形态** | "独立"作为立场很好，但作为产品壁垒很弱。建议：**内核独立 + 同时提供 MCP/Agent Skill 形态**，让 Cursor/Claude Code 也能调用你 |
| 3 | 真正的所见即所得 + 可靠写回 | ✅ **保留，这是核心** | 也是最难、最容易被低估成本的一条。必须做成"确定性优先、AI 兜底" |
| 4 | 智能布局编辑（理解 Flex/Grid） | ✅ **强化，升为一级特性** | Replit 只做了 Flex 基础控件；Grid、断点归属、容器查询、clamp() 都没人做透。这是**技术深水区 = 壁垒** |
| 5 | 无损组件替换 | ❌ **MVP 砍掉，降级到 V2** | 公开信息里没人做成；成本极高、收益不确定。可先做一个弱版本："样式预设套用"（只改 class/token，不换组件） |
| 6 | 参考图视觉还原 | ⚠️ **降级，做成 V2 的"视觉差异报告"** | 直接"照图改"容易翻车；先做"列出差异清单 + 人工确认 + 逐条应用"更可控 |
| 7 | 低 Token 成本 | ⚠️ **保留但不是卖点** | Replit 已经这么宣传了。你的优势应该是"确定性"，低 token 是它的副产品 |
| 8 | 安全且可逆 | ✅ **强化，升为一级特性** | 没人把"变更审阅"做成一等公民。这是对抗 Agent 路线"越改越乱"的最强武器 |

---

## 4. 差异化候选：4 个我认为值得押注的方向

### A. 确定性编辑层（Deterministic Edit Layer）— 最强候选 【推断，需验证】

核心命题：**80% 的视觉微调（间距、字号、颜色、圆角、对齐、gap、文本）可以用 AST 变换精确写回，不需要 LLM。**

价值主张一句话：**"你拖 8px，代码里就只多了 8px，其它一行不变。"** 这正好是 Agent 路线做不到的（Agent 会顺手改别处、会重写整个 className、会引入它自己的审美）。

可行技术路径【推断】：
- 文字改动 → JSX 文本节点 / 字符串字面量的 AST 替换（最稳）
- Tailwind 类 → 解析 className 字符串 → 按"类别"替换（如 `p-4` → `p-6`），用 ts-morph / babel 改 AST 节点，已有成熟先例（`tailwind-classname-parser`、`tailwind-theme-sweep`、`ast-grep` 规则）
- 颜色/字号等 token → 优先写回 CSS 变量 / Tailwind theme，而不是硬编码值
- 无法确定性处理的（动态 className、styled-components 模板串、条件样式）→ **显式降级给 AI，并在 UI 上标明"这次改动会调用 AI"**

关键设计：**每条操作都要能回答"我要改哪个文件、哪一行、从什么变成什么"**，改不了就明确说改不了，而不是偷偷交给 AI 猜。

### B. 变更单（Change Set）与逐条审阅 — 最容易被忽略的护城河 【推断】

把每一次可视化操作变成一条**结构化变更记录**：
`{ id, type: 'style'|'layout'|'text'|'class', target: {file, line, componentStack}, before, after, confidence: 'deterministic'|'ai', risky: boolean }`

UI 上表现为底部"变更篮"：可预览 diff、逐条丢弃、批量应用/回滚、一键 `git checkout`。

**为什么这是护城河**：所有走 Agent 的产品，改动是一个不可拆的"黑盒 diff"；你能给出"可拆、可挑、可撤"的粒度。这直接命中你说的"越改越乱"。

### C. 布局语义编辑（Layout-Aware Editing）【推断，技术壁垒最高】

不做"拖到哪儿就 absolute 定位到哪儿"，而是：
- 拖动 = 在**布局语义空间**里操作：改变 flex direction / order / gap / align / justify / grid span，而不是写 `left/top`
- 检测到目标容器是 Grid → 提供行列/跨格编辑；是 Flex → 提供轴/对齐/间距；是普通流 → **提示用户先选一个布局容器**，或拒绝随意绝对定位
- 断点归属：改动时明确"这次改动只作用于 base / md / lg 哪个断点"，写入对应的 `md:` 前缀

这条做透了，是竞品短期内最难抄的，因为它需要对 CSS 布局语义建模 + 反解 computed style。

### D. 审美一致性 / Anti-Slop 层 【假设，需小样本验证】

用户抱怨"AI 做的页面不好看"本质是三件事：
1. **默认值审美**（紫渐变、Inter、三卡片、全部 fade-up）—— 有清晰的可检测特征
2. **局部不一致**（同一个语义的元素间距/圆角/字重各不一样）
3. **层级缺失**（没有视觉焦点）

可以做的确定性检查（不需要 LLM 或只需很轻的模型）：
- 扫描全站 computed style，统计"同一语义不同值"的离群点（圆角种类数、灰度种类数、字号档位数）
- 对比度 / 可访问性检查
- 与参考图的结构化差异（位置 + 色值 + 字号偏差）

**风险**：审美判断主观性极强，很容易做成"看起来很蠢的建议"。建议 MVP 只做**"客观不一致"**，不做"我觉得不好看"。

---

## 5. 交互设计：10 条我认为必须遵守的原则

1. **选中即定位**：hover/click 元素后，立刻显示"组件栈 + 文件:行号"，一键跳 IDE。这是建立信任的第一步（code-inspector / React Grab 一类工具已经教育了用户）。
2. **右侧面板按"能否确定性改"分区**，不要照抄 Figma。建议分区：`内容 / 布局 / 间距 / 颜色 / 字体 / 边框&阴影 / 危险区（需 AI）`。
3. **每个控件上标注改动代价**：确定性改动无标记；需要 AI 的显示小图标。让用户知道"这一下会不会烧 token、会不会不可控"。
4. **禁止无声降级**：确定性写回失败时，不要静默转给 AI。弹提示："无法精确定位（原因：className 是动态拼接），是否交给 AI？"
5. **多实例必须显式提示**：选中一个循环渲染出来的卡片时，明确提示"该元素有 12 个实例，本次将全部修改 / 仅修改此实例"，并默认只改当前实例。
6. **拖动优先改语义，其次才改数值**：横向拖动容器内元素优先建议"改 gap / order / direction"，而不是写 margin。
7. **永远提供"改之前 vs 改之后"的 DOM 快照对比 + 代码 diff**，且 diff 是逐文件的。
8. **变更篮常驻底部**（见 4.B），支持 `Cmd+Z` 逐条撤销、支持"只应用选中的 3 条"。
9. **断点切换是一等公民**：工具栏上有 base/sm/md/lg/xl，改动自动带前缀；改 base 时提示"会影响所有尺寸"。
10. **不要做"画布"**。至少 MVP 不要。画布会诱惑你去重新实现渲染，从而偏离"真实运行页面"这个核心承诺。要做的是"真实页面 + 覆盖层 + 面板"。

---

## 6. 技术难点排序与解法

### 难点 1：DOM 元素 → 源码位置映射（最基础，决定一切）

三档方案，**建议做"渐进式降级"**：

| 档位 | 方案 | 侵入性 | 精度 | 适用 |
|---|---|---|---|---|
| L0 | **React Fiber `_debugSource`**：dev 模式下 JSX dev transform 自动注入 `__source`，挂在 fiber 上；从 DOM 节点找 `__reactFiber$xxx` 即可拿到 file/line/column | **零配置**（Vite/CRA/Next dev 默认就有） | 组件级 + 行列 | React dev 模式，MVP 首选 |
| L1 | **编译期插桩**：babel/swc/vite 插件注入 `data-<id>` 属性（Onlook 老版做法），建立 id ↔ 源码位置的索引表 | 需用户装插件/改配置 | 元素级，最精确 | 需要精确到"第 3 个 div"时 |
| L2 | **Sourcemap + CSS 选择器兜底** | 无 | 弱，易错 | 兜底，不保证 |

**【推断】** L0 是 MVP 的最优解：零配置 = 零摩擦。代价是：只有 React（且 dev 模式）、只有组件级定位、生产构建没有。**建议 MVP 明确锁定 "React dev 模式"**，把 90% 精力花在写回而不是定位上。

Vue/Svelte 有对应的 `__file` + vite 插件（`vite-plugin-vue-inspector` / `code-inspector-plugin` 已支持全框架），可留到 V2。

### 难点 2：样式写回矩阵（决定"确定性"能做到多少）

| 样式系统 | 确定性改写的难度 | 建议 MVP 支持度 |
|---|---|---|
| Inline style | 低 | ✅ 必做 |
| Tailwind className（静态字符串） | 中（要按类别替换、处理冲突类、处理 `hover:`/`md:` 前缀） | ✅ 必做 |
| Tailwind v4（CSS-first `@theme`）token | 中（改的是 CSS 变量定义，影响面大） | ⚠️ 只读展示 + 显式"影响 N 处"确认 |
| CSS Modules / 普通 CSS 文件 | 中（PostCSS AST 可改，但要找到对应规则，且选择器可能不唯一） | ⚠️ V1 只读，V2 可改 |
| `clsx` / `cn()` / `cva()` 动态拼接 | 高 | ❌ 降级给 AI（并明确告知） |
| styled-components / emotion | 高（模板串 + 运行时） | ❌ V1 不支持 |
| CSS 变量 / 主题 token | 中（改一处影响全局，需要影响面预览） | ⚠️ 需要强确认 |

**最重要的原则**：**宁可明确说"这个改不了"，也不要猜着改。** 猜 = 破坏信任 = 用户回到 Agent。

### 难点 3：组件实例 vs 组件定义

选中一个 `<Button>` 的使用处，改它的样式，应该改：
- 使用处的 `className`（推荐，影响最小）✅
- 还是组件定义文件（影响所有 20 处）❌

规则建议：
- 默认改**使用处**，如果元素是组件根且组件有 `className` 透传 → 加/改 `className`
- 如果组件不透传 `className` → 明确提示"该组件不接受 className，是否需要 AI 修改组件定义（影响 20 处）"
- 提供"提升到组件定义"的显式入口，并要求二次确认 + 影响面预览

### 难点 4：布局与响应式不写坏

反模式（必须避免）：拖到 (x, y) → 写 `position: absolute; left: 120px; top: 40px`。
正确做法：
- 先解析目标容器 computed style 属于哪种布局上下文（flow / flex / grid / absolute / sticky）
- 在该上下文的语义集合内提供操作
- 拖动跨容器时：在 flex/grid 内 → 改 `order` / 移动 JSX 节点（AST 层面的子节点移动，这是最"真"的改动）
- **移动 DOM = 移动 JSX AST 节点**，这是确定性可做的，而且写回后代码结构天然正确

### 难点 5：与 HMR / git / dev server 的协同

- 每次写回 → 触发 HMR → 覆盖层需要重新绑定（元素 id 稳定性很重要，L1 插桩的 `data-id` 在这里有明显优势）
- 上下文丢失是最大的体验杀手：**建议在写回前保存"选中的元素路径"**（组件栈 + 同类索引），写回后按路径重新选中
- 与 git：所有改动先落在工作区，提供"提交前 diff"；**不要自动 commit**

### 难点 6：宿主形态选择（Electron vs 浏览器扩展 vs 本地 Web）

| 形态 | 优点 | 缺点 | 建议 |
|---|---|---|---|
| **本地 CLI + 浏览器扩展 / 注入脚本**（stagewise 模式） | 零安装成本、跨平台、用用户自己的浏览器和 devtools | 权限受限、覆盖层样式易被页面 CSS 污染、跨 iframe 麻烦 | ✅ **MVP 首选** |
| **Electron 桌面 App**（Onlook/Subframe 模式） | 可嵌入 webview + CDP、文件系统完全可控、可跑 git | 体积大、跨平台分发成本高、macOS 签名/公证烦 | ⚠️ V2 |
| **本地 Web 编辑器**（localhost + iframe） | 开发快 | iframe 跨源、用户 dev server 与编辑器耦合 | ❌ 不建议（Onlook 老版已放弃） |
| **Tauri** | 体积小 | macOS 用 WKWebView，**拿不到 CDP**，深度注入能力受限 | ❌ 对本场景不友好 |

> **注意**：如果走 Electron，务必确认你需要的是"注入脚本 + 覆盖层"还是"CDP 低级控制"。Tauri 在 macOS 上的 WKWebView 无法用 CDP，这是一个容易被忽略的架构陷阱。**【推断】**

---

## 7. 架构建议（保持可扩展，避免后期重写）

建议按"**内核 / 适配器 / 宿主**"三层切，内核完全不依赖 UI：

```
┌─ 宿主层（可替换，多个并行）────────────────────────┐
│ CLI (npx)  │  浏览器扩展  │  Electron App  │ MCP Server │
└──────────────────────────────────────────────────┘
                    ↓ 统一 RPC（建议 tRPC 或简单 WebSocket）
┌─ 编辑内核（纯 TS，可单测）────────────────────────┐
│ 1. Locator      : DOM ↔ 源码位置（L0/L1/L2 三档，可插拔）│
│ 2. Inspector    : computed style → 结构化样式模型     │
│ 3. Planner      : 用户操作 → 变更计划（ChangeSet）    │
│     ├─ DeterministicWriter（AST：jsx/ts-morph/postcss）│
│     └─ AIWriter（可选，显式调用，带 diff 校验）        │
│ 4. LayoutModel  : flex/grid/断点/容器查询语义建模      │
│ 5. Applier      : 写文件 + HMR + 变更审计 + 回滚栈     │
└──────────────────────────────────────────────────┘
                    ↓
┌─ 项目适配层（每个技术栈一个 adapter）──────────────┐
│ react-vite │ next-app │ next-pages │ (v2) vue │ (v2) svelte │
│ tailwind-v3 │ tailwind-v4 │ css-modules │ plain-css      │
└──────────────────────────────────────────────────┘
```

**三条架构纪律**（避免后期大重构）：
1. **内核不许 import 任何 UI 框架**，只允许纯函数 + 依赖注入的文件系统接口 → 长尾可单测，也可复用到 MCP/CLI。
2. **所有"改代码"必须产出 ChangeSet（计划）再执行**，禁止直接写文件 → 这是撤销、diff、批量应用、AI 校验的唯一支点。
3. **Locator 必须可插拔**（L0/L1/L2）→ 你现在用 L0，将来上 L1 插桩时内核不用改。

---

## 8. MVP 定义（建议）

### V0.1 —— "改得准"（目标：2~3 周，单人 + AI 辅助开发）

**做**：
- 目标栈锁定：`React + Vite`（先把一条路走通，Next.js 留 V0.2）
- Locator：L0（Fiber `_debugSource`），零配置
- 元素选择（hover 高亮 + 点击选中 + 组件栈面包屑 + 跳 IDE）
- 确定性改动 4 类：**文本、间距（padding/margin/gap）、颜色、字号**
- 写回：Tailwind 静态 className + inline style
- 变更篮：逐条 diff、逐条撤销、批量应用
- 交付形态：`npx xxx` 起本地服务 + 浏览器覆盖层（stagewise 式）

**不做**（明确写进 README 的 Non-goals）：
- 拖拽自由定位、组件库替换、Figma 导入、协作、AI 圈选、多设备完整预览、Vue/Svelte、styled-components、CSS Modules 写入、画布

### V0.2 —— "改得稳"
- Next.js App Router 支持
- Flex/Grid 语义布局编辑（direction / align / justify / gap / order / grid span）
- 断点归属（改动写入 `md:` 等前缀）
- JSX 节点移动（拖拽调顺序 → AST 子节点移动）
- MCP Server：让 Cursor / Claude Code 调用"确定性地把某元素 padding 改成 X"

### V0.3 —— "改得美"
- 一致性审计（离群间距/圆角/色值检测）
- 参考图视觉差异报告（只读 + 逐条确认应用）
- Electron 桌面版（可选）

---

## 9. 如何用 AI Coding 高效开发这个产品（验证优先）

**原则：先做 4 个技术 Spike 验证"能不能做到"，再写产品。** 这 4 个 Spike 恰好都能用 AI Coding 高效产出，因为它们是"边界清晰的单点问题"。

| Spike | 目标 | 通过标准 | 时间盒 |
|---|---|---|---|
| **S1 定位** | 在 Vite+React 项目里，鼠标 hover 任意 DOM → 拿到 `file:line:column` + 组件栈 | 在 3 个不同开源项目上成功率 > 90% | 1 天 |
| **S2 写回** | 把"把某元素 padding 从 p-4 改成 p-6"变成一次 AST 编辑，diff 只有一行 | 10 个真实用例，9 个 diff 干净；失败时正确报错 | 2 天 |
| **S3 稳定性** | 写回后触发 HMR，自动按"组件栈路径"重新选中原元素 | 连续 20 次改动不丢选中 | 1 天 |
| **S4 布局语义** | 对一个 flex 容器做"改 direction / 改 order"，不产生任何 `position:absolute` | 5 种真实布局（导航、卡片列表、表单、Hero、侧边栏）全部保持响应式 | 2 天 |

**判断规则**：S1+S2 通过 → 项目成立；S4 通过 → 你有了真壁垒；任一 Spike 做不到 → 重新定位（大概率要退回"Agent 增强"路线）。

**用 AI Coding 开发的自我约束**（否则会重蹈"越改越乱"）：
- 内核模块先写**测试用例**（输入 DOM 上下文 + 预期 AST diff），让 AI 补实现
- 所有写回逻辑必须有 golden test：`fixtures/原始.tsx` → `fixtures/期望.tsx`
- 不让 AI 直接改 UI 层，UI 层你自己定结构，AI 只填细节

---

## 10. 拍板记录与遗留问题

### 已拍板（2026-10-26）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 目标用户 | **先用 AI Coding 的开发者**（非开发者是 V2 叙事） |
| 2 | 首版技术栈 | **Vite + React + TypeScript + Tailwind**（Next.js 放 V0.2） |
| 3 | MVP 属性范围 | 接受"确定性优先、改不了就明说"的原则 |
| 4 | 形态优先级 | **Vite 插件 + 本地服务 + 浏览器覆盖层**（CLI+注入最快验证） |
| 6 | 覆盖哪些痛点 | **三个都要**：找不到元素 / 描述不清 / 改完 A 坏了 B |

> **"三个都要"的代价与应对**：不能三件事都做深。MVP 的做法是**一条最小闭环，每个痛点各配一个最小能力**（定位 / 结构化属性面板 / 变更篮），任何一个做不深可以后续加深，但**闭环必须一次打通**——因为单独的"定位"价值有限（已有 code-inspector 类工具），价值恰恰来自三者串联。
> 详见 `V0.1-技术方案与Spike计划.md`。

### 仍待拍板

5. **商业化路径**：独立订阅 / 卖给平台（被收购）/ 开源+托管？——不阻塞 MVP，但会影响是否要 cloud 形态。
7. **Tailwind v3 还是 v4**：v4（CSS-first `@theme`）已是 2026 主流，但 token 改动的影响面更大。建议 **v4 为主、v3 兼容**（className 改写逻辑两者基本一致），如你有偏好请说明。
8. **是否要求用户仓库必须 git 干净**：这决定了回滚机制的可靠度。建议 MVP 要求 `git status` 干净才允许写回（拒绝则只读预览）。

---

## 附：本文引用的主要来源

- Onlook GitHub 仓库 README 与提交记录（2026-07）· `github.com/onlook-dev/onlook`
- Onlook 官方文档 `docs.onlook.com`（Welcome / Architecture，描述 macOS 桌面端 + git worktree + Agent + PR）
- `cursor.com/docs/agent/design-mode`（点选/圈画/语音 → Agent；上下文含 xpath、组件、computed styles、fiber props + 截图）
- `docs.replit.com/design/visual-editor`（确定性改动不消耗 AI credits；Flexbox 控件 2026-05）
- `docs.subframe.com/quickstart`、`/browser/making-live-edits`（Inspect → 改 props/styles/classes → Send → Agent）
- stagewise GitHub / HN Show HN (YC S25) · `npx stagewise` 代理 dev server 注入工具栏
- `chrome-devtools-mcp`（Chrome DevTools 官方 MCP；Chrome 144+ 支持连接现有会话与选中元素）
- Safari Technology Preview 247 引入 MCP（WebKit 博客，2026-07，媒体报道）
- React Grab 原理文章（Fiber `_debugSource` 由 `@babel/plugin-transform-react-jsx-source` 注入，dev 模式默认可用）
- `code-inspector-plugin` / `vite-plugin-code-inspector`（编译期注入 file:line，支持全框架）
- `tailwind-classname-parser`、`tailwind-theme-sweep`（ts-morph AST 改写 className 的成熟先例）
- Subframe / modeinspect 的竞品对比文章（价格与能力边界，2026-10 更新）
