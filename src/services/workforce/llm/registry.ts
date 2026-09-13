import { EmployeeModelProfile, LLMProviderKind } from '../../../data/types';
import { LLMProvider } from './types';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';

export function getLLMProvider(profile: Pick<EmployeeModelProfile, 'provider' | 'baseUrl'>): LLMProvider {
  switch (profile.provider) {
    case 'ollama':
      return new OllamaProvider(profile.baseUrl);
    case 'openai':
      return new OpenAIProvider(profile.baseUrl);
    default:
      return assertNever(profile.provider);
  }
}

export function isSupportedProviderKind(kind: string): kind is LLMProviderKind {
  return kind === 'ollama' || kind === 'openai';
}

function assertNever(value: never): never {
  throw new Error(`unsupported provider kind: ${String(value)}`);
}