import { createServer, type Server as HttpServer } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import type { LayoutOp } from '../core/layout/apply-layout.js';
import type { StyleOp } from '../core/write/apply.js';
import { handleStudioRequest } from '../studio/serve.js';
import { EditError, EditSession } from './session.js';
import type { ClientMessage, ServerMessage } from './protocol.js';

const LAYOUT_OP_KINDS = new Set([
  'flexDirection',
  'alignItems',
  'justifyContent',
  'gap',
  'order',
  'gridColumn',
  'gridRow',
  'gridCols',
  'gridRows',
  'childOrder',
]);

export function isLayoutOp(op: { kind: string }): op is LayoutOp {
  return LAYOUT_OP_KINDS.has(op.kind);
}

export interface StartServerOptions {
  projectRoot: string;
  port?: number;
  host?: string;
}

export interface RunningServer {
  port: number;
  host: string;
  session: EditSession;
  close: () => Promise<void>;
}

/** 启动本地服务：HTTP（健康检查）+ WebSocket（覆盖层通信）。 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { projectRoot } = options;
  const host = options.host ?? '127.0.0.1';
  const session = new EditSession(projectRoot);
  // 端口要等 listen 之后才知道，但 Studio 页面在 listen 前就已注册好处理函数
  let runningPort = 0;

  const httpServer: HttpServer = createServer((req, res) => {
    void handleStudioRequest(req, res, {
      projectRoot,
      // 端口在 listen 之后才知道；Studio 页面上的连接提示用的是这个值，
      // 所以这里用闭包读，而不是把创建时的 undefined 固化下来。
      get port() {
        return runningPort;
      },
      changes: () => session.getChanges(),
      undo: (changeId) => {
        session.undo(changeId);
      },
    }).then((handled) => {
      if (handled) return;
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, projectRoot, changes: session.getChanges().length }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const send = (socket: WebSocket, message: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const broadcast = (message: ServerMessage): void => {
    for (const client of wss.clients) send(client, message);
  };

  wss.on('connection', (socket) => {
    send(socket, { type: 'ready', payload: { projectRoot, clientCount: wss.clients.size } });

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        send(socket, { type: 'error', payload: { message: '消息格式错误' } });
        return;
      }

      try {
        handleMessage(message, socket, session, broadcast, send, projectRoot);
      } catch (error) {
        if (error instanceof EditError) {
          send(socket, { type: 'error', payload: { message: error.message, detail: error.detail } });
        } else {
          send(socket, {
            type: 'error',
            payload: { message: '服务内部错误', detail: String(error) },
          });
        }
      }
    });
  });

  const port = await new Promise<number>((resolvePort, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? 0, host, () => {
      const address = httpServer.address();
      resolvePort(typeof address === 'object' && address ? address.port : 0);
    });
  });
  runningPort = port;

  return {
    port,
    host,
    session,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => httpServer.close(() => resolveClose()));
      }),
  };
}

function handleMessage(
  message: ClientMessage,
  socket: WebSocket,
  session: EditSession,
  broadcast: (m: ServerMessage) => void,
  send: (socket: WebSocket, message: ServerMessage) => void,
  projectRoot: string,
): void {
  switch (message.type) {
    case 'hello':
      send(socket, { type: 'ready', payload: { projectRoot, clientCount: 1 } });
      return;

    case 'ping':
      send(socket, { type: 'pong' });
      return;

    case 'history':
      send(socket, { type: 'history', payload: { changes: session.getChanges() } });
      return;

    case 'requestChange': {
      const { locator, op, summary } = message.payload;
      const outcome = isLayoutOp(op)
        ? session.applyLayoutChange(locator, op, summary)
        : session.applyStyleChange(locator, op as StyleOp, summary);
      broadcast({
        type: 'changeApplied',
        payload: { change: outcome.record, anchor: outcome.anchor },
      });
      return;
    }

    case 'requestStructure': {
      const { locator, op, summary } = message.payload;
      const outcome = session.applyStructureChange(locator, op, summary);
      broadcast({
        type: 'changeApplied',
        payload: {
          change: outcome.record,
          anchor: outcome.anchor,
          select: outcome.select,
        },
      });
      return;
    }

    case 'undo': {
      const record = session.undo(message.payload.changeId);
      broadcast({ type: 'changeUndone', payload: { changeId: record.id } });
      return;
    }

    default:
      send(socket, { type: 'error', payload: { message: '未知消息类型' } });
  }
}
