import { strict as assert } from 'node:assert';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { OllamaProvider } from '../../src/services/workforce/llm/ollamaProvider';
import { OpenAIProvider } from '../../src/services/workforce/llm/openaiProvider';
import { getLLMProvider, isSupportedProviderKind } from '../../src/services/workforce/llm/registry';
import { HttpError } from '../../src/services/workforce/llm/httpTransport';

interface CapturedRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

type FakeHandler = (req: http.IncomingMessage, res: http.ServerResponse, body: Record<string, unknown>) => void;

function startFakeServer(handler: FakeHandler): Promise<{
  server: http.Server;
  port: number;
  captured: CapturedRequest[];
}> {
  const captured: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
    });
    req.on('end', () => {
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      captured.push({ url: req.url || '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, captured });
    });
  });
}

function jsonResponse(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

describe('LLM providers', () => {
  it('ollama posts /api/chat and parses message content + token usage', async () => {
    const { server, port, captured } = await startFakeServer((req, res, body) => {
      jsonResponse(res, 200, {
        model: body.model,
        message: { role: 'assistant', content: 'flat test' },
        prompt_eval_count: 4,
        eval_count: 2
      });
    });
    try {
      const provider = new OllamaProvider(`http://127.0.0.1:${port}`);
      const res = await provider.chat({
        model: 'llama3',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2
      });

      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].url, '/api/chat');
      assert.deepStrictEqual(captured[0].body.model, 'llama3');
      assert.deepStrictEqual(captured[0].body.stream, false);
      assert.deepStrictEqual(captured[0].body.options, { temperature: 0.2 });
      assert.strictEqual(res.text, 'flat test');
      assert.deepStrictEqual(res.usage, { promptTokens: 4, completionTokens: 2, totalTokens: 6 });
    } finally {
      server.close();
    }
  });

  it('openai posts /chat/completions with bearer token and parses response', async () => {
    const { server, port, captured } = await startFakeServer((req, res) => {
      jsonResponse(res, 200, {
        choices: [{ message: { role: 'assistant', content: 'hello from openai' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      });
    });
    try {
      const provider = new OpenAIProvider(`http://127.0.0.1:${port}/v1`);
      const res = await provider.chat({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'be terse' }, { role: 'user', content: 'ping' }],
        apiKey: 'sk-test',
        temperature: 0,
        maxTokens: 100
      });

      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].url, '/v1/chat/completions');
      assert.strictEqual(captured[0].headers.authorization, 'Bearer sk-test');
      assert.strictEqual(captured[0].body.temperature, 0);
      assert.strictEqual(captured[0].body.max_tokens, 100);
      assert.strictEqual(captured[0].body.stream, false);
      assert.strictEqual(res.text, 'hello from openai');
      assert.deepStrictEqual(res.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    } finally {
      server.close();
    }
  });

  it('openai provider forwards non-2xx as HttpError', async () => {
    const { server, port } = await startFakeServer((req, res) => {
      jsonResponse(res, 401, { error: { message: 'bad key' } });
    });
    try {
      const provider = new OpenAIProvider(`http://127.0.0.1:${port}/v1`);
      await assert.rejects(
        () => provider.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }], apiKey: 'nope' }),
        (err: unknown) => err instanceof HttpError && err.status === 401
      );
    } finally {
      server.close();
    }
  });

  it('registry selects providers by kind and rejects unknown kinds', async () => {
    const ollama = getLLMProvider({ provider: 'ollama' });
    const openai = getLLMProvider({ provider: 'openai' });
    assert.strictEqual(ollama.kind, 'ollama');
    assert.strictEqual(openai.kind, 'openai');
    assert.strictEqual(isSupportedProviderKind('ollama'), true);
    assert.strictEqual(isSupportedProviderKind('openai'), true);
    assert.strictEqual(isSupportedProviderKind('claude'), false);
    assert.strictEqual(isSupportedProviderKind('opencode'), false);
  });

  it('default base urls are stable', () => {
    assert.strictEqual(OllamaProvider.defaultBaseUrl(), 'http://localhost:11434');
    assert.strictEqual(OpenAIProvider.defaultBaseUrl(), 'https://api.openai.com/v1');
  });
});