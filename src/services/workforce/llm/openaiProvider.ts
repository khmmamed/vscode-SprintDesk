import { postJson, HttpError } from './httpTransport';
import { LLMProvider, ProviderRequest, ProviderResponse } from './types';

export const DEFAULT_OPENAI_BASEURL = 'https://api.openai.com/v1';

export class OpenAIProvider implements LLMProvider {
  readonly kind = 'openai' as const;

  constructor(private readonly baseUrl: string = DEFAULT_OPENAI_BASEURL) {}

  static defaultBaseUrl(): string {
    return DEFAULT_OPENAI_BASEURL;
  }

  private endpoint(): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    return `${base}/chat/completions`;
  }

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    const endpoint = this.endpoint();
    const headers: Record<string, string> = {};
    if (request.apiKey) {
      headers.authorization = `Bearer ${request.apiKey}`;
    }

    const result = await postJson(endpoint, {
      headers,
      body: {
        model: request.model,
        messages: request.messages,
        stream: false,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
      },
      timeoutMs: request.timeoutMs
    });

    if (result.status !== 200) {
      throw new HttpError(result.status, `openai: HTTP ${result.status}`);
    }

    const data = result.json as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    } | undefined;

    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) {
      throw new Error('openai: empty assistant message');
    }

    return {
      text,
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
        totalTokens: data?.usage?.total_tokens
      },
      raw: data
    };
  }
}