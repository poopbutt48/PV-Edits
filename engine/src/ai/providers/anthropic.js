// Connects the AI helper to Claude, using the user's own API key.
// The key is sent only to Anthropic's API, directly from this device.
import Anthropic from '@anthropic-ai/sdk';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 - best results', price: '$4 in / $20 out per million tokens' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 - faster and cheaper', price: '$2 in / $10 out per million tokens' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 - cheapest, for simple tasks', price: '$0.10 in / $0.50 out per million tokens' },
];

export const EFFORTS = [
  ['low', 'Quick - fastest and cheapest'],
  ['medium', 'Balanced (recommended)'],
  ['high', 'Thorough - best for big changes'],
];

export class ProviderError extends Error {
  constructor(message, { retryable = false, auth = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.auth = auth;
  }
}

export function createAnthropicProvider({ apiKey, model = 'claude-opus-5-5', effort = 'medium' }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const isHaiku = model.startsWith('claude-haiku');
  return {
    id: 'claude',
    label: MODELS.find((m) => m.id === model)?.label || model,
    async send({ system, tools, messages, onText, onProgress, signal }) {
      const params = {
        model,
        max_tokens: 64000,
        system: [{ type: 'text', text: system }],
        tools: tools.map((t) => ({ ...t, eager_input_streaming: true })),
        messages,
        cache_control: { type: 'ephemeral' },
        output_config: { effort },
      };
      if (isHaiku) {
        params.thinking = { type: 'adaptive' };
      } else {
        // Short progress notes between tool calls, shown as status lines,
        // and an automatic retry on another model if a request is declined.
        params.thinking = { type: 'adaptive', display: 'updates' };
        params.fallbacks = 'default';
        params.betas = ['thinking-display-updates-2026-08-18', 'server-side-fallback-2026-07-01'];
      }
      const stream = client.beta.messages.stream(params);
      const abort = () => stream.abort();
      if (signal) {
        if (signal.aborted) abort();
        signal.addEventListener('abort', abort);
      }
      if (onText) stream.on('text', (_d, snapshot) => onText(snapshot));
      if (onProgress) stream.on('thinking', (_d, snapshot) => { if (snapshot && snapshot.trim()) onProgress(snapshot); });
      try {
        return await stream.finalMessage();
      } catch (err) {
        throw toFriendlyError(err);
      } finally {
        if (signal) signal.removeEventListener('abort', abort);
      }
    },
  };
}

function toFriendlyError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return Object.assign(new ProviderError('Stopped.'), { cancelled: true });
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError('Your API key was not accepted. Check it in Settings → AI helper.', { auth: true });
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError('Your API key is not allowed to use this model. Try another model in Settings → AI helper.', { auth: true });
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('The AI is getting too many requests right now (rate limit). Wait a minute and try again.', { retryable: true });
  if (err instanceof Anthropic.BadRequestError) return new ProviderError(`The AI service rejected the request: ${err.message}`);
  if (err instanceof Anthropic.InternalServerError) return new ProviderError('The AI service had a problem. Please try again in a moment.', { retryable: true });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('Could not reach the AI service. Check your internet connection.', { retryable: true });
  if (err instanceof Anthropic.APIError) return new ProviderError(`AI service error (${err.status}): ${err.message}`);
  // Anything else (for example a tool input that could not be read) can be retried once.
  const e = new ProviderError(`Something went wrong talking to the AI: ${err && err.message ? err.message : err}`, { retryable: true });
  e.parse = true;
  return e;
}
