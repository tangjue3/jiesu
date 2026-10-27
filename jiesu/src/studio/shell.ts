/**
 * Studio 壳的 HTML 骨架与设计令牌。
 *
 * 令牌来自 UI 参考 V2（`docs/reference/ui-v2/原始说明.md`），这里是唯一真源——
 * 后续页面要新增颜色/间距，都从这份 CSS 变量里取，不要在各处硬编码色值。
 *
 * 形态决定：浏览器版 Studio（`/studio`）。桌面封装留到后面，
 * 因为面板、iframe、覆盖层这套东西在浏览器里就是最完整的形态。
 */

export interface NavItem {
  /** 页面标识，对应 main.ts 里的 switch */
  id: string;
  label: string;
  /** 内联 SVG 的 path/内容（不用图标库，避免多一个依赖） */
  icon: string;
  /** 是否已实现；未实现的显示"即将上线"占位 */
  ready: boolean;
}

/**
 * 导航顺序与参考图一致：首页 / 项目 / 画布 / 组件 / 样式 / 适配 / AI / 代码，设置沉到底部。
 * 只有画布与代码是真的——其余六个诚实地标"即将上线"，不做假界面。
 */
export const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: '首页',
    icon: '<path d="M3 10.5 12 3l9 7.5V21H3z"/>',
    ready: false,
  },
  {
    id: 'projects',
    label: '项目',
    icon: '<path d="M3 6h6l2 3h10v12H3z"/>',
    ready: false,
  },
  {
    id: 'canvas',
    label: '画布',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    ready: true,
  },
  {
    id: 'components',
    label: '组件',
    icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    ready: false,
  },
  {
    id: 'styles',
    label: '样式',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18"/>',
    ready: false,
  },
  {
    id: 'responsive',
    label: '适配',
    icon: '<rect x="2" y="5" width="13" height="10" rx="1.5"/><rect x="17" y="9" width="5" height="10" rx="1.5"/>',
    ready: false,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
    ready: false,
  },
  {
    id: 'code',
    label: '代码',
    icon: '<path d="M9 7 4 12l5 5"/><path d="M15 7l5 5-5 5"/>',
    ready: true,
  },
];

const CSS = `
:root {
  --bg: #F7F9FC;
  --panel: #FFFFFF;
  --border: #E8ECF3;
  --primary: #5276F5;
  --primary-soft: #EEF2FE;
  --violet: #A78BFA;
  --mint: #64CDB4;
  --text: #1F2937;
  --text-2: #64748B;
  --text-3: #94A3B8;
  --danger: #E5484D;
  --radius: 12px;
  --rail: 72px;
  --topbar: 60px;
  --font: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font); font-size: 13px; -webkit-font-smoothing: antialiased;
}
button { font-family: inherit; font-size: inherit; color: inherit; cursor: pointer; }
input { font-family: inherit; font-size: inherit; color: inherit; }

.app { display: flex; height: 100%; }

/* 左导航：72px 纯白通高 */
.rail {
  width: var(--rail); flex: 0 0 var(--rail); background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; padding: 14px 0 12px; gap: 4px;
}
.logo {
  width: 34px; height: 34px; border-radius: 10px; margin-bottom: 12px;
  background: linear-gradient(135deg, var(--primary), var(--violet));
  display: grid; place-items: center; color: #fff; font-weight: 600; font-size: 15px;
  box-shadow: 0 4px 12px rgba(82,118,245,.28);
}
.nav-item {
  width: 56px; padding: 7px 0 6px; border: 0; border-radius: 10px; background: transparent;
  display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--text-2);
}
.nav-item svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.nav-item span { font-size: 11px; line-height: 1.2; }
.nav-item:hover { background: var(--bg); color: var(--text); }
.nav-item.on { background: var(--primary-soft); color: var(--primary); }
.nav-item.todo { opacity: .45; }
.rail-gap { flex: 1; }

/* 主区 */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  height: var(--topbar); flex: 0 0 var(--topbar); background: var(--panel);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px; padding: 0 18px;
}
.topbar h1 { font-size: 16px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
.topbar .sub { color: var(--text-3); font-size: 12px; }
.topbar .spacer { flex: 1; }

.url-field {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px;
  border: 1px solid var(--border); border-radius: 9px; background: var(--bg); min-width: 300px;
}
.url-field input { flex: 1; border: 0; background: transparent; outline: none; font-size: 12px; }
.url-field input::placeholder { color: var(--text-3); }

.btn {
  height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--panel); font-size: 12px; font-weight: 500;
}
.btn:hover { border-color: #d7dEEA; }
.btn.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.btn.primary:hover { filter: brightness(1.04); }
.btn.ghost { background: transparent; }
.btn:disabled { opacity: .45; cursor: not-allowed; }

.seg { display: flex; background: var(--bg); border: 1px solid var(--border); border-radius: 9px; padding: 2px; }
.seg button { height: 26px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; font-size: 12px; color: var(--text-2); }
.seg button.on { background: var(--panel); color: var(--text); box-shadow: 0 1px 2px rgba(16,24,40,.08); }

.pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-2); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
.dot.ok { background: var(--mint); }
.dot.bad { background: var(--danger); }

.content { flex: 1; min-height: 0; overflow: auto; }
.page { display: none; height: 100%; }
.page.on { display: flex; }

/* 画布 */
.stage {
  flex: 1; min-width: 0; overflow: auto; padding: 20px;
  display: flex; align-items: flex-start;
  /* 不用 justify-content:center：画板比可视区宽时，居中会把左右两边都裁掉且滚不到 */
  justify-content: flex-start;
}
.frame {
  /* 不能收缩：flex 容器里默认 flex-shrink:1 会把 1440 压成可视宽度 */
  flex: 0 0 auto;
  /* 比可视区窄时居中，宽时靠左（auto 外边距在溢出时会归零） */
  margin: 0 auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: 0 8px 28px rgba(16,24,40,.06); overflow: hidden;
  display: flex; flex-direction: column;
}
.frame-bar {
  height: 30px; flex: 0 0 30px; display: flex; align-items: center; gap: 8px;
  padding: 0 12px; border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 11px;
  background: #FCFDFF;
}
.frame iframe { width: 100%; border: 0; background: #fff; display: block; }

.empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: var(--text-2); text-align: center; padding: 40px;
}
.empty h2 { font-size: 16px; font-weight: 600; color: var(--text); margin: 0; }
.empty p { margin: 0; max-width: 460px; line-height: 1.7; font-size: 12.5px; }
.empty code { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; font-size: 11.5px; }

/* 代码页 */
.code-wrap { flex: 1; min-width: 0; display: flex; }
.change-list { width: 320px; flex: 0 0 320px; background: var(--panel); border-right: 1px solid var(--border); overflow: auto; }
.change-list .head { padding: 12px 14px 8px; color: var(--text-3); font-size: 11px; letter-spacing: .04em; }
.change {
  padding: 10px 14px; border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: flex-start;
}
.change:hover { background: var(--bg); }
.change.on { background: var(--primary-soft); }
.change .body { flex: 1; min-width: 0; }
.change .sum { font-size: 12.5px; line-height: 1.5; }
.change .meta { color: var(--text-3); font-size: 11px; margin-top: 2px; font-family: ui-monospace, Menlo, monospace; }
.diff { flex: 1; min-width: 0; overflow: auto; padding: 16px 20px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.7; }
.diff .row { white-space: pre-wrap; word-break: break-word; padding: 1px 8px; border-radius: 4px; }
.diff .del { background: #FDECEC; color: #8B1F23; }
.diff .add { background: #E9F8F1; color: #10603F; }
.diff .same { color: var(--text-3); }
.diff .title { font-family: var(--font); color: var(--text-2); margin-bottom: 10px; }
`;

function railHtml(): string {
  const items = NAV_ITEMS.map((item) => {
    const cls = item.ready ? 'nav-item' : 'nav-item todo';
    const title = item.ready ? item.label : `${item.label}（即将上线）`;
    return `<button class="${cls}" data-nav="${item.id}" title="${title}">
      <svg viewBox="0 0 24 24">${item.icon}</svg><span>${item.label}</span>
    </button>`;
  }).join('');

  return `<nav class="rail">
    <div class="logo">界</div>
    ${items}
    <div class="rail-gap"></div>
    <button class="nav-item todo" data-nav="settings" title="设置（即将上线）">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>
      <span>设置</span>
    </button>
  </nav>`;
}

export function renderShell(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>界塑 · Studio</title>
<style>${CSS}</style>
</head>
<body>
<div class="app">
  ${railHtml()}
  <div class="main">
    <header class="topbar">
      <h1 id="page-title">画布</h1>
      <span class="sub" id="page-sub"></span>
      <div class="spacer"></div>
      <div class="seg" id="device-switch">
        <button data-device="desktop" class="on">桌面</button>
        <button data-device="tablet">平板</button>
        <button data-device="mobile">手机</button>
      </div>
      <span class="pill"><i class="dot" id="ws-dot"></i><span id="ws-text">未连接</span></span>
      <div class="url-field">
        <input id="url-input" placeholder="http://localhost:5173" spellcheck="false" />
        <button class="btn" id="open-btn">打开</button>
      </div>
    </header>

    <div class="content">
      <section class="page on" data-page="canvas">
        <div class="stage" id="stage">
          <div class="empty" id="canvas-empty">
            <h2>还没有打开页面</h2>
            <p>在上面填一个正在运行的开发服务器地址（例如 <code>http://localhost:5173</code>），
            点「打开」即可把真实页面载入画布。页面里按 <code>Alt+Shift+J</code> 就能开始编辑。</p>
          </div>
          <div class="frame" id="frame" style="display:none">
            <div class="frame-bar"><span id="frame-label">桌面 · 1440</span></div>
            <iframe id="canvas-frame" title="画布" src="about:blank"></iframe>
          </div>
        </div>
      </section>

      <section class="page" data-page="code">
        <div class="code-wrap">
          <aside class="change-list">
            <div class="head" id="change-count">变更篮</div>
            <div id="change-items"></div>
          </aside>
          <div class="diff" id="diff-view"></div>
        </div>
      </section>

      <section class="page" data-page="todo">
        <div class="empty">
          <h2 id="todo-title">即将上线</h2>
          <p id="todo-desc"></p>
        </div>
      </section>
    </div>
  </div>
</div>
<script src="/studio/main.js"></script>
</body>
</html>`;
}
