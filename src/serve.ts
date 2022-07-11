import type { HttpResponse, us_listen_socket } from 'uws';
import type { Handler, ListenOptions, NetAddress, ServeInit } from './types.js';

import { App, us_listen_socket_close as close } from 'uws';
import { Request, Response } from 'undici';
import { TextDecoder } from 'util';
import { setImmediate } from 'timers';
import { ReadableStream } from 'stream/web';

import { checkMultithreadingSupport } from './multithread.js';

const respond = async (http: HttpResponse, response: Response) => {
  const body = await response.arrayBuffer();
  const small = body.byteLength < 16384;

  http.cork(() => {
    http.writeStatus(`${response.status} ${response.statusText}`);

    response.headers.forEach((value, key) => {
      http.writeHeader(key, value);
    });

    if (small) {
      http.end(body, true);
    }
  });

  if (!small) {
    setImmediate(() => {
      const offset = http.getWriteOffset();
      const end = http.tryEnd(body, body.byteLength);

      if (end[0] || end[1]) {
        return;
      }

      http.onWritable((written) => http.tryEnd(body.slice(written - offset), body.byteLength)[0]);
    });
  }
};

const onError = (ex: unknown) => {
  console.error(ex);

  return new Response(null, {
    status: 500
  });
};

const onListen = (params: ListenOptions) => {
  console.log(`Listening on http://${params.hostname}:${params.port}/`);
};

export const serve = async (handler: Handler, options: ServeInit = {}) => {
  checkMultithreadingSupport();

  return new Promise<void>((resolve, reject) => {
    const port = options.port || 8000;
    const hostname = options.hostname || '127.0.0.1';
    const handleError = options.onError || onError;
    const handleListen = options.onListen || onListen;
    const signal = options.signal || null;

    const localAddr: NetAddress = {
      port,
      hostname,
      transport: 'tcp'
    };

    const decoder = new TextDecoder('utf-8');

    const app = App();

    app.any('/*', async (http, incoming) => {
      const abort = new AbortController();

      http.onAborted(abort.abort);

      const headers: Record<string, string> = {};

      incoming.forEach((key, value) => {
        headers[key] = value;
      });

      const method = incoming.getMethod().toUpperCase();

      const body = method === 'OPTIONS' || method === 'GET' || method === 'HEAD' ?
        null :
        new ReadableStream({
          type: 'bytes',
          pull(controller) {
            http.onData((chunk, isLast) => {
              controller.enqueue(new Uint8Array(chunk));
              if (isLast) {
                controller.close();
              }
            });
          }
        });

      let response: Response;

      try {
        response = await handler(new Request(`http://${hostname}:${port}${incoming.getUrl()}`, {
          method,
          body,
          headers,
          signal: abort.signal
        }), {
          localAddr,
          remoteAddr: {
            port: 80,
            hostname: decoder.decode(http.getRemoteAddressAsText()),
            transport: 'tcp'
          }
        });
      } catch (ex: unknown) {
        if (abort.signal.aborted) {
          return http.close();
        }

        response = await handleError(ex);
      }

      try {
        await respond(http, response);
      } catch (ex: unknown) {
        await respond(http, onError(ex));
      }
    });

    const listen = (socket: us_listen_socket | false) => {
      if (socket) {
        if (signal !== null) {
          if (signal.aborted) {
            close(socket);
          } else if (
            // @ts-expect-error missing type
            typeof signal.addEventListener === 'function'
          ) {
            // @ts-expect-error missing type
            signal.addEventListener('abort', () => {
              close(socket);
            });
          } else {
            // @ts-expect-error missing type
            signal.onabort = () => {
              close(socket);
            };
          }
        }

        handleListen(localAddr);

        resolve();
      } else {
        reject(new Error(`EADDRINUSE: address already in use ${hostname}:${port}`));
      }
    };

    app.listen(hostname, port, listen);
  });
};
