import { postJson, HttpError } from './httpTransport';
import { LLMProvider, ProviderRequest, ProviderResponse } from './types';

export const DEFAULT_OLLAMA_BASEURL = 'http://localhost:11434';

export class OllamaProvider implements LLMProvider {
  readonly kind = 'ollama' as const;

  constructor(private readonly baseUrl: string = DEFAULT_OLLAMA_BASEURL) {}

  static defaultBaseUrl(): string {
    return DEFAULT_OLLAMA_BASEURL;
  }

  private endpoint(): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    return `${base}/api/chat`;
  }

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    const endpoint = this.endpoint();
    const result = await postJson(endpoint, {
      body: {
        model: request.model,
        messages: request.messages,
        stream: false,
        ...(request.temperature !== undefined ? { options: { temperature: request.temperature } } : {})
      },
      timeoutMs: request.timeoutMs
    });

    if (result.status !== 200) {
      throw new HttpError(result.status, `ollama: HTTP ${result.status}`);
    }

    const data = result.json as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    } | undefined;

    const text = data?.message?.content ?? '';
    if (!text) {
      throw new Error('ollama: empty assistant message');
    }

    return {
      text,
      usage: {
        promptTokens: data?.prompt_eval_count,
        completionTokens: data?.eval_count,
        totalTokens:
          data?.prompt_eval_count !== undefined && data?.eval_count !== undefined
            ? data.prompt_eval_count + data.eval_count
            : undefined
      },
      raw: data
    };
  }
}