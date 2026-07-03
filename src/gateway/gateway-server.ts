import { createGatewayHttpServer } from "./http-server.js";
import { createGatewayUnixSocketServer } from "./unix-socket-server.js";
import { createGatewayWebSocketServer } from "./websocket-server.js";

export function createGatewayServer(config, { cronScheduler } = { cronScheduler: undefined }) {
  const httpServer = createGatewayHttpServer(config);
  const unixSocketServer = createGatewayUnixSocketServer();
  const websocketServer = createGatewayWebSocketServer(config, { httpServer, cronScheduler });
  let unixSocketStarted = false;

  function listenHttpServer() {
    return new Promise<void>((resolve, reject) => {
      const onError = (error) => {
        httpServer.off("error", onError);
        reject(error);
      };

      httpServer.once("error", onError);
      httpServer.listen(config.port, "127.0.0.1", () => {
        httpServer.off("error", onError);
        resolve();
      });
    });
  }

  function closeHttpServer() {
    return new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return {
    listen() {
      return listenHttpServer();
    },
    listenWithUnixSocket() {
      return listenHttpServer().then(async () => {
        try {
          await unixSocketServer.listen();
          unixSocketStarted = true;
        } catch (error) {
          await closeHttpServer();
          throw error;
        }
      });
    },
    close() {
      return websocketServer.close().then(
        () =>
          (unixSocketStarted ? unixSocketServer.close() : Promise.resolve()).then(
            () =>
              closeHttpServer(),
          ),
      );
    },
  };
}
