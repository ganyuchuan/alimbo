import fs from "node:fs";
import net from "node:net";

const ALIMBO_SOCK_PATH = "/tmp/alimbo.sock";

function safeUnlink(pathname: string) {
  try {
    fs.unlinkSync(pathname);
  } catch {
    // Ignore when file does not exist or cannot be removed.
  }
}

function parseSocketLine(rawLine: string) {
  const text = String(rawLine ?? "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error: any) {
    console.warn(`[gateway][unix-socket] invalid json message: ${String(error?.message ?? error)}`);
    return null;
  }
}

function logSocketEvent(payload: any) {
  const event = String(payload?.event ?? payload?.hook_event_name ?? "unknown").trim() || "unknown";
  const sessionId = String(payload?.session_id ?? payload?.sessionId ?? "").trim() || "-";
  const toolName = String(payload?.tool_name ?? payload?.tool ?? payload?.toolName ?? "").trim() || "-";
  console.log(`[gateway][unix-socket] event=${event} sessionId=${sessionId} tool=${toolName}`);
}

export function createGatewayUnixSocketServer() {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = "";

    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
      buffer += String(chunk ?? "");
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        const payload = parseSocketLine(line);
        if (payload) {
          logSocketEvent(payload);
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });

    socket.on("error", () => {
      sockets.delete(socket);
    });
  });

  return {
    listen() {
      return new Promise<void>((resolve, reject) => {
        safeUnlink(ALIMBO_SOCK_PATH);

        server.once("error", reject);
        server.listen(ALIMBO_SOCK_PATH, () => {
          server.off("error", reject);
          console.log(`[gateway][unix-socket] listening on ${ALIMBO_SOCK_PATH}`);
          resolve();
        });
      });
    },
    close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      return new Promise<void>((resolve) => {
        server.close(() => {
          safeUnlink(ALIMBO_SOCK_PATH);
          resolve();
        });
      });
    },
  };
}
