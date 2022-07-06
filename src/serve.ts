import type { HttpResponse, us_listen_socket } from 'uws';
import type { Response } from 'undici';
import type { Handler, NetAddress, ServeInit } from './types.js';

import { App } from 'uws';
import { Request } from 'undici';
import { TextDecoder } from 'util';

import { CHUNKED, noop } from './utils.js';
import { ReadableStream } from 'stream/web';

const respond = async (http: HttpResponse, response: Response) => {
  http.writeStatus(`${response.status} ${response.statusText}`);

  response.headers.forEach((value, key) => {
    http.writeHeader(key, value);
  });

  const body = await response.arrayBuffer();

  if (body.byteLength < CHUNKED) {
    http.end(body);

    return;
  }

  const offset = http.getWriteOffset();
  const end = http.tryEnd(body, body.byteLength);

  if (end[0] || end[1]) {
    return;
  }

  http.onWritable((written) => http.tryEnd(body.slice(written - offset), body.byteLength)[0]);
};

export const serve = async (handler: Handler, options: ServeInit = {}) => {
  return new Promise<void>((resolve, reject) => {
    const {
      port = 8000,
      hostname = '127.0.0.1',
      onError = noop,
      onListen = noop
    } = options;

    const localAddr: NetAddress = {
      port,
      hostname,
      transport: 'tcp'
    };

    const decoder = new TextDecoder('utf-8');

    const app = App();

    app.any('/*', async (http, incoming) => {
      let aborted = false;

      try {
        http.onAborted(() => {
          aborted = true;
        });

        const headers: Record<string, string> = {};

        incoming.forEach((key, value) => {
          headers[key] = value;
        });

        const method = incoming.getMethod().toUpperCase();

        const body = method === 'OPTIONS' || method === 'GET' ?
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

        const response = await handler(new Request(`http://${hostname}:${port}${incoming.getUrl()}`, {
          method,
          body,
          headers,
          signal: options.signal
        }), {
          localAddr,
          remoteAddr: {
            port: 80,
            hostname: decoder.decode(http.getRemoteAddressAsText()),
            transport: 'tcp'
          }
        });

        if (aborted) {
          return;
        }

        await respond(http, response);
      } catch (ex: unknown) {
        if (aborted) {
          return;
        }

        const response = await onError(ex);

        await respond(http, response);
      }
    });

    const listen = (socket: us_listen_socket | false) => {
      if (socket) {
        onListen(localAddr);

        resolve();
      } else {
        reject(new Error(`serve EADDRINUSE: address already in use ${hostname}:${port}`));
      }
    };

    app.listen(hostname, port, listen);
  });
};
