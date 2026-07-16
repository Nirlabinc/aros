/**
 * Shared BYOM provider catalog. Single source of truth for the provider presets
 * used by both the onboarding model step and the AI Models settings page, so
 * the two never drift or duplicate the list. Browser-safe metadata only —
 * credentials are never part of this contract.
 */
import { DEFAULT_MODEL } from './model-defaults';

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'ollama' | 'custom';

export interface ProviderPreset {
  provider: ProviderId;
  label: string;
  placeholder: string;
  defaultModel: string;
  docs: string;
  needsKey: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { provider: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-...', defaultModel: 'claude-sonnet-4-6', docs: 'https://console.anthropic.com', needsKey: true },
  { provider: 'openai', label: 'OpenAI', placeholder: 'sk-...', defaultModel: 'gpt-4o', docs: 'https://platform.openai.com/api-keys', needsKey: true },
  { provider: 'google', label: 'Google Gemini', placeholder: 'AIza...', defaultModel: 'gemini-2.5-flash', docs: 'https://aistudio.google.com', needsKey: true },
  { provider: 'ollama', label: 'Ollama (local)', placeholder: 'No key needed', defaultModel: 'llama3.2', docs: 'https://ollama.ai', needsKey: false },
  { provider: 'custom', label: 'Custom (OpenAI-compatible)', placeholder: 'API key (optional)', defaultModel: '', docs: '', needsKey: false },
];

export function presetFor(provider: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.provider === provider) ?? PROVIDER_PRESETS[0];
}

/**
 * The AROS-managed recommended default. Local, private inference that is already
 * provisioned for every workspace at signup — no key, no external call.
 */
export const RECOMMENDED_MODEL = {
  id: DEFAULT_MODEL.id,
  provider: DEFAULT_MODEL.provider,
  label: DEFAULT_MODEL.label,
  endpoint: DEFAULT_MODEL.endpoint,
  tagline: 'Private, AROS-managed inference. No API key, nothing leaves your workspace.',
} as const;
