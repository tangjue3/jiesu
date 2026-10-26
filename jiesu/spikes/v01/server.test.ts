import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSource } from '../../src/core/locate/parse';
import { startServer, type RunningServer } from '../../src/server/server';
import type { ServerMessage } from '../../src/server/protocol';

const APP_TSX = `export function App() {
  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <h1 className="text-lg font-semibold">标题</h1>
    </div>
  );
}
`;

/** 找到 className 含指定 token 的元素的定位信息。 */
function locate(code: string, token: string, filePath: string) {
  const ast = parseSource(code);
  const hits: Array<{ line: number; column: number }> = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; loc?: { start?: { line?: number; column?: number } } };
    if (n.type === 'JSXOpeningElement' && n.loc?.start) {
      hits.push({ line: n.loc.start.line!, column: n.loc.start.column! });
    }
    for (const key of Object.keys(node as object)) {
      if (key === 'loc') continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast);

  const index = hits.findIndex((h) => {
    const line = code.split('\n')[h.line - 1] ?? '';
    return line.includes(token);
  });
  if (index === -1) throw new Error(`找不到含 ${token} 的元素`);
  return { filePath, line: hits[index].line, column: hits[index].column };
}

describe('V0.1 · 编辑服务', () => {
  let projectRoot: string;
  let server: RunningServer;
  let socket: WebSocket;
  const messages: ServerMessage[] = [];

  beforeEach(async () => {
    projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'jiesu-v01-')));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'App.tsx'), APP_TSX, 'utf8');

    server = await startServer({ projectRoot, port: 0, host: '127.0.0.1' });
    socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    messages.length = 0;
    // 先注册监听再等待 open，否则会漏掉连接瞬间下发的 ready
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise<void>((resolve) => socket.on('open', () => resolve()));
  });

  afterEach(async () => {
    socket.close();
    await server.close();
  });

  const waitFor = async <T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = messages.find((m) => m.type === type) as
        | Extract<ServerMessage, { type: T }>
        | undefined;
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`等待 ${type} 超时，已收到：${messages.map((m) => m.type).join(',')}`);
  };

  it('连接后下发项目根目录', async () => {
    await waitFor('ready');
    const ready = messages.find((m) => m.type === 'ready');
    expect(ready).toBeDefined();
    if (ready?.type === 'ready') {
      expect(ready.payload.projectRoot).toBe(projectRoot);
    }
  });

  it('可视化修改会真正写回源码文件', async () => {
    const filePath = join(projectRoot, 'src', 'App.tsx');
    const code = readFileSync(filePath, 'utf8');
    const locator = locate(code, 'px-6', 'src/App.tsx');

    socket.send(
      JSON.stringify({
        type: 'requestChange',
        payload: {
          locator,
          op: { kind: 'classByPx', category: 'spacing', prefix: 'px', fromPx: 24, toPx: 32 },
          summary: '左右内边距 24px → 32px',
        },
      }),
    );

    const applied = await waitFor('changeApplied');
    expect(applied.payload.change.summary).toContain('32px');

    const updated = readFileSync(filePath, 'utf8');
    expect(updated).toContain('px-8');
    expect(updated).not.toContain('px-6');
    // 其余内容一字未动
    expect(updated.replace('px-8', 'px-6')).toBe(code);
  });

  it('变更篮：可逐条撤销，文件恢复原样', async () => {
    const filePath = join(projectRoot, 'src', 'App.tsx');
    const original = readFileSync(filePath, 'utf8');
    const locator = locate(original, 'text-lg', 'src/App.tsx');

    socket.send(
      JSON.stringify({
        type: 'requestChange',
        payload: {
          locator,
          op: { kind: 'class', category: 'fontSize', fromBase: 'text-lg', toBase: 'text-xl' },
          summary: '字号 text-lg → text-xl',
        },
      }),
    );

    const applied = await waitFor('changeApplied');
    expect(readFileSync(filePath, 'utf8')).toContain('text-xl');

    socket.send(
      JSON.stringify({ type: 'undo', payload: { changeId: applied.payload.change.id } }),
    );
    await waitFor('changeUndone');

    expect(readFileSync(filePath, 'utf8')).toBe(original);
    expect(server.session.getChanges()).toHaveLength(0);
  });

  it('改不了的时候返回明确原因，而不是静默失败', async () => {
    const code = readFileSync(join(projectRoot, 'src', 'App.tsx'), 'utf8');
    const locator = locate(code, 'text-lg', 'src/App.tsx');

    socket.send(
      JSON.stringify({
        type: 'requestChange',
        payload: {
          locator,
          op: { kind: 'class', category: 'color', fromBase: 'text-lg', toBase: 'text-white' },
          summary: '把字号类当颜色类改（应失败）',
        },
      }),
    );

    const error = await waitFor('error');
    expect(error.payload.message).toContain('没有找到');
  });

  it('拒绝写入项目目录之外的文件', async () => {
    const code = readFileSync(join(projectRoot, 'src', 'App.tsx'), 'utf8');
    const locator = { ...locate(code, 'text-lg', 'src/App.tsx'), filePath: '../../etc/hosts' };

    socket.send(
      JSON.stringify({
        type: 'requestChange',
        payload: {
          locator,
          op: { kind: 'text', to: 'x' },
          summary: '越界写入',
        },
      }),
    );

    const error = await waitFor('error');
    expect(error.payload.message).toContain('项目目录');
  });
});
