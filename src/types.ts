import type { Request, Response } from 'undici';

export type AnyFunction = (...args: any[]) => any;

export type NetAddress = {
  hostname: string;
  port: number;
  transport: 'tcp';
};

export type ConnectionInfo = {
  readonly localAddr: NetAddress;
  readonly remoteAddr: NetAddress;
};

export type Handler = (request: Request, connInfo: ConnectionInfo) => Response | Promise<Response>;

export type ListenOptions = {
  hostname?: string;
  port: number;
};

export type ServeInit = Partial<ListenOptions> & {
  onError?: (error: unknown) => Response | Promise<Response>;
  onListen?: (params: {
    hostname: string;
    port: number;
  }) => void;
  signal?: AbortSignal;
};
