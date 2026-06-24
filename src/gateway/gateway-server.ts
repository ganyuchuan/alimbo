import { createGatewayHttpServer } from "./http-server.js";
import { createGatewayUnixSocketServer } from "./unix-socket-server.js";
import { createGatewayWebSocketServer } from "./websocket-server.js";

export function createGatewayServer(config, { cronScheduler } = { cronScheduler: undefined }) {
  const httpServer = createGatewayHttpServer(config);
  const unixSocketServer = createGatewayUnixSocketServer();
  const websocketServer = createGatewayWebSocketServer(config, { httpServer, cronScheduler });

  return {
    listen() {
      return new Promise<void>((resolve, reject) => {
        httpServer.listen(config.port, "127.0.0.1", async () => {
          try {
            await unixSocketServer.listen();
            resolve();
          } catch (error) {
            httpServer.close(() => reject(error));
          }
        });
      });
    },
    close() {
      return websocketServer.close().then(
        () =>
          unixSocketServer.close().then(
            () =>
              new Promise<void>((resolve, reject) => {
                httpServer.close((error) => {
                  if (error) {
                    reject(error);
                    return;
                  }
                  resolve();
                });
              }),
          ),
      );
    },
  };
}
