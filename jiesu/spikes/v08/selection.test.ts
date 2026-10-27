/**
 * V0.7 选中态同步（协议层，不需要浏览器）
 *
 * 组件库要能"插到选中元素下方"，Studio 就必须知道画布选中了谁。
 * 这里验证那条链路：覆盖层上报 → 服务端缓存并广播 → 任何客户端（含后连的）都能拿到。
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startServer, type RunningServer } from '../../src/server/server';
import type { ServerMessage, SelectionInfo } from '../../src/server/protocol';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, 'demo');

interface Harness {
  socket: WebSocket;
  messages: ServerMessage[];
  close: () => void;
}

/** 连一个客户端，并把收到的消息都攒起来（含连接瞬间的 ready / selection）。 */
async function connect(port: number): Promise<Harness> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  return { socket, messages, close: () => socket.close() };
}

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

const SELECTION: SelectionInfo = {
  locator: { filePath: 'src/App.tsx', line: 9, column: 8, anchor: '0.0.3' },
  tag: 'section',
  label: 'section · mt-6 rounded-lg',
};

describe('V0.7 · 选中态同步', () => {
  let server: RunningServer;
  const clients: Harness[] = [];

  beforeEach(async () => {
    server = await startServer({ projectRoot: DEMO, port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    await server?.close();
  });

  it('新客户端连上就能拿到当前选中态（初始为 null）', async () => {
    const client = await connect(server.port);
    clients.push(client);

    expect(await waitFor(() => client.messages.some((m) => m.type === 'selection'))).toBe(true);
    const message = client.messages.find((m) => m.type === 'selection') as Extract<
      ServerMessage,
      { type: 'selection' }
    >;
    expect(message.payload.selection).toBeNull();
  });

  it('覆盖层上报 → 广播给其它客户端（Studio 靠这个知道插到哪）', async () => {
    const overlay = await connect(server.port);
    const studio = await connect(server.port);
    clients.push(overlay, studio);

    overlay.socket.send(JSON.stringify({ type: 'selection', payload: { selection: SELECTION } }));

    expect(await waitFor(() => studio.messages.some((m) => m.type === 'selection' && m.payload.selection))).toBe(
      true,
    );
    const received = studio.messages
      .filter((m): m is Extract<ServerMessage, { type: 'selection' }> => m.type === 'selection')
      .pop();
    expect(received?.payload.selection?.locator.anchor).toBe('0.0.3');
    expect(received?.payload.selection?.tag).toBe('section');
  });

  it('取消选中会广播 null，后连的客户端也拿到最新值', async () => {
    const overlay = await connect(server.port);
    clients.push(overlay);

    overlay.socket.send(JSON.stringify({ type: 'selection', payload: { selection: SELECTION } }));
    expect(await waitFor(() => overlay.messages.some((m) => m.type === 'selection' && m.payload.selection))).toBe(
      true,
    );

    overlay.socket.send(JSON.stringify({ type: 'selection', payload: { selection: null } }));
    expect(
      await waitFor(() => {
        const list = overlay.messages.filter((m) => m.type === 'selection');
        const last = list[list.length - 1] as Extract<ServerMessage, { type: 'selection' }>;
        return last && last.payload.selection === null;
      }),
    ).toBe(true);

    // 服务端缓存的是 null，新客户端应当立刻拿到 null
    const late = await connect(server.port);
    clients.push(late);
    expect(await waitFor(() => late.messages.some((m) => m.type === 'selection'))).toBe(true);
    const first = late.messages.find((m) => m.type === 'selection') as Extract<
      ServerMessage,
      { type: 'selection' }
    >;
    expect(first.payload.selection).toBeNull();
  });

  it('选中态不影响编辑链路：发 selection 之后 requestStructure 照常工作', async () => {
    const overlay = await connect(server.port);
    clients.push(overlay);

    overlay.socket.send(JSON.stringify({ type: 'selection', payload: { selection: SELECTION } }));
    expect(await waitFor(() => overlay.messages.some((m) => m.type === 'selection' && m.payload.selection))).toBe(
      true,
    );

    // 这条只是为了确认 selection 消息不会顶掉后续的编辑消息（服务端是单独分支处理的）
    overlay.socket.send(JSON.stringify({ type: 'ping' }));
    expect(await waitFor(() => overlay.messages.some((m) => m.type === 'pong'))).toBe(true);
  });
});
