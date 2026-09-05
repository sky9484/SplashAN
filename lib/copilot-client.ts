/**
 * Browser helper for talking to the 0xWal chat API (/api/copilot/chat).
 *
 * `streamCopilot` consumes the Server-Sent Events stream and invokes handlers as
 * tokens arrive (real streaming). It returns false on any failure so callers can
 * fall back to a local response — the chat must never hard-fail.
 */

export type CopilotTurn = { role: 'user' | 'assistant'; content: string };

export type CopilotMeta = {
  memories: string[];
  memoryCount: number;
  memwalEnabled: boolean;
  source: 'claude' | 'grounded';
};

export type StreamHandlers = {
  onMeta?: (meta: CopilotMeta) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
};

export async function streamCopilot(
  message: string,
  history: CopilotTurn[],
  handlers: StreamHandlers,
): Promise<boolean> {
  try {
    const res = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotAnyDelta = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt: { type?: string; text?: string } & Partial<CopilotMeta>;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        if (evt.type === 'meta') {
          handlers.onMeta?.({
            memories: evt.memories ?? [],
            memoryCount: evt.memoryCount ?? 0,
            memwalEnabled: Boolean(evt.memwalEnabled),
            source: (evt.source as CopilotMeta['source']) ?? 'grounded',
          });
        } else if (evt.type === 'delta' && evt.text) {
          gotAnyDelta = true;
          handlers.onDelta?.(evt.text);
        } else if (evt.type === 'done') {
          handlers.onDone?.();
        }
      }
    }
    return gotAnyDelta;
  } catch {
    return false;
  }
}
