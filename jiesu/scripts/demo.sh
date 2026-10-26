#!/usr/bin/env bash
#
# 一键启动 jiesu 演示：先起编辑服务，再起 demo 的 vite。
#
#   ./scripts/demo.sh                 # 默认用 spikes/v03/demo（图层面板演示）
#   ./scripts/demo.sh spikes/v02/demo # 指定别的靶场
#   PORT=5300 ./scripts/demo.sh       # 换端口
#
# 打开浏览器访问打印出来的地址，按 Alt+Shift+J 进入选择模式。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO="${1:-$ROOT/spikes/v03/demo}"
PORT="${PORT:-5273}"
NODE_BIN="${NODE_BIN:-node}"
VITE_BIN="$ROOT/node_modules/.bin/vite"

if [ ! -f "$ROOT/dist/cli/bin.js" ]; then
  echo "缺少构建产物，先执行：npm run build" >&2
  exit 1
fi
if [ ! -d "$DEMO" ]; then
  echo "找不到 demo 目录：$DEMO" >&2
  exit 1
fi

# 1) 编辑服务（WebSocket）：写 .jiesu/server.json 供 vite 插件读取
"$NODE_BIN" "$ROOT/dist/cli/bin.js" --root "$DEMO" &
JIESU_PID=$!
trap 'kill "$JIESU_PID" 2>/dev/null || true' EXIT INT TERM

# 等它写好端口
for _ in $(seq 1 50); do
  [ -f "$DEMO/.jiesu/server.json" ] && break
  sleep 0.1
done
if [ ! -f "$DEMO/.jiesu/server.json" ]; then
  echo "编辑服务没有起来（.jiesu/server.json 未生成）" >&2
  exit 1
fi

echo ""
echo "  demo      $DEMO"
echo "  打开      http://127.0.0.1:$PORT/"
echo "  操作      Alt+Shift+J 选择元素 · Alt+Shift+L 图层面板 · 拖动已选元素调整顺序"
echo "  退出      Ctrl+C"
echo ""

# 2) dev server（前台运行，Ctrl+C 一起退出）
cd "$DEMO"
"$VITE_BIN" --host 127.0.0.1 --port "$PORT" --strictPort
