import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorWebSocket } from "./connector";

/**
 * Production went deaf for three hours with the connection still reporting
 * `healthy`: the relay stopped delivering events without ever closing the
 * socket, so the supervisor's `onclose` recovery never ran. `ws` alone cannot
 * reproduce that — its server auto-answers pings — so this completes the
 * WebSocket handshake by hand and then says nothing at all, which is exactly
 * what a half-open connection looks like from our side.
 */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function silentWebSocketServer(): Promise<{ server: Server; port: number }> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.once("data", (chunk) => {
      const key = /sec-websocket-key:\s*(.+)/i.exec(chunk.toString())?.[1]?.trim();
      const accept = createHash("sha1")
        .update(`${key}${GUID}`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      // Deliberately nothing further. No pong, no close, no FIN.
    });
  });
  server.on("close", () => sockets.forEach((socket) => socket.destroy()));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: (server.address() as { port: number }).port,
      });
    });
  });
}

describe("ConnectorWebSocket heartbeat", () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("terminates a socket that stops answering, so recovery can run", async () => {
    const started = await silentWebSocketServer();
    server = started.server;

    // Only the timer is faked, so the real socket still connects. Calling
    // terminate() by hand here would prove nothing about the heartbeat -- the
    // interval itself has to be what kills the connection.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const socket = new ConnectorWebSocket(`ws://127.0.0.1:${started.port}`);
      await new Promise((resolve) => socket.once("open", resolve));
      expect(socket.readyState).toBe(ConnectorWebSocket.OPEN);

      const closed = new Promise<void>((resolve) =>
        socket.once("close", () => resolve()),
      );
      vi.advanceTimersByTime(30_000); // first tick: send a ping
      expect(socket.readyState).toBe(ConnectorWebSocket.OPEN);
      vi.advanceTimersByTime(30_000); // second tick: no pong ever arrived
      await closed;

      expect(socket.readyState).toBe(ConnectorWebSocket.CLOSED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open while the peer answers", async () => {
    // A `ws` server auto-answers pings, which is the healthy case.
    const { WebSocketServer } = await import("ws");
    const healthy = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => healthy.once("listening", resolve));
    const port = (healthy.address() as { port: number }).port;
    try {
      const socket = new ConnectorWebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((resolve) => socket.once("open", resolve));
      const ponged = new Promise<void>((resolve) =>
        socket.once("pong", () => resolve()),
      );
      socket.ping();
      await ponged;
      expect(socket.readyState).toBe(ConnectorWebSocket.OPEN);
      socket.close();
    } finally {
      healthy.close();
    }
  });
});
