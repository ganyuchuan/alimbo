import { createGatewayHttpServer } from "./http-server.js";
import { createGatewayWebSocketServer } from "./websocket-server.js";

export function createGatewayServer(config, { cronScheduler } = { cronScheduler: undefined }) {
  const httpServer = createGatewayHttpServer(config);
  const websocketServer = createGatewayWebSocketServer(config, { httpServer, cronScheduler });

  return {
    listen() {
      return new Promise<void>((resolve) => {
        httpServer.listen(config.port, "127.0.0.1", () => resolve());
      });
    },
    close() {
      return websocketServer.close().then(
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
      );
    },
  };
}
