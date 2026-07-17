/**
 * Reduce a /v1/chat envelope to a display string. The envelope varies by
 * router path: deterministic fast-paths return a string `content`, while the
 * model path passes through the provider envelope where `message` is an
 * OBJECT ({ role, content }) and the normalized string lives in `content`.
 * Rendering an object as a React child crashes the whole page — whatever the
 * shape, this always returns a string.
 */
export function chatReplyText(data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string' && v.trim()) return v;
    if (v && typeof v === 'object') {
      const content = (v as Record<string, unknown>).content;
      if (typeof content === 'string' && content.trim()) return content;
    }
    return null;
  };
  return pick(d.response) ?? pick(d.message) ?? pick(d.content) ?? 'No response received.';
}
