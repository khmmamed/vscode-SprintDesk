import { LLMProviderKind, EmployeeModelProfile } from '../../../data/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ProviderResponse {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

export interface LLMProvider {
  readonly kind: LLMProviderKind;
  chat(request: ProviderRequest): Promise<ProviderResponse>;
}

export function profileToRequest(profile: EmployeeModelProfile, messages: ChatMessage[]): ProviderRequest {
  return {
    model: profile.model,
    messages,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKeyRef,
    temperature: profile.options?.temperature,
    maxTokens: profile.options?.maxTokens,
    timeoutMs: profile.options?.timeoutMs
  };
}
