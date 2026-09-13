import * as http from 'http';
import * as https from 'https';

export interface HttpPostOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  body: unknown;
}

export interface HttpPostResult {
  status: number;
  text: string;
  json: unknown | undefined;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string
  ) {
    super(message);
  }
}

export async function postJson(url: string, options: HttpPostOptions): Promise<HttpPostResult> {
  const { method = 'POST', headers = {}, timeoutMs = 60_000, body } = options;
  const bodyStr = JSON.stringify(body);

  return new Promise<HttpPostResult>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(bodyStr),
          ...headers
        }
      },
      res => {
        let text = '';
        res.on('data', chunk => {
          text += chunk;
        });
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          const status = res.statusCode ?? 500;
          if (status < 200 || status >= 300) {
            reject(new HttpError(status, `HTTP ${status}`, text.slice(0, 500)));
            return;
          }
          resolve({ status, text, json });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });

    req.setTimeout(timeoutMs);
    req.write(bodyStr);
    req.end();
  });
}

export async function getJson(url: string, options: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<HttpPostResult> {
  const { headers = {}, timeoutMs = 30_000 } = options;
  return new Promise<HttpPostResult>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers,
        timeout: timeoutMs
      },
      res => {
        let text = '';
        res.on('data', chunk => {
          text += chunk;
        });
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          const status = res.statusCode ?? 500;
          if (status < 200 || status >= 300) {
            reject(new HttpError(status, `HTTP ${status}`, text.slice(0, 500)));
            return;
          }
          resolve({ status, text, json });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('request timed out'));
    });
  });
}