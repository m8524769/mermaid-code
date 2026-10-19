import { describe, expect, it } from 'vitest';
import { mergeMessage, type AgentMessage } from './agentState.svelte';

const msg = (over: Partial<AgentMessage>): AgentMessage => ({
  id: 'm1',
  role: 'assistant',
  text: '',
  ...over
});

describe('mergeMessage', () => {
  it('preserves existing thinking when the incoming message has none', () => {
    // Live Claude stream: a thinking-only assistant event, then text-only
    // events (same id, no thinking) that would otherwise clobber it on upsert.
    const prev = msg({ text: '', thinking: 'reasoning…' });
    const next = msg({ text: 'answer', thinking: undefined });
    const merged = mergeMessage(prev, next);
    expect(merged.thinking).toBe('reasoning…');
    expect(merged.text).toBe('answer');
  });

  it('treats null thinking (Rust None → JSON null) as absent and preserves prev', () => {
    const prev = msg({ thinking: 'reasoning…' });
    const next = msg({ text: 'answer', thinking: null as unknown as undefined });
    expect(mergeMessage(prev, next).thinking).toBe('reasoning…');
  });

  it('lets a new non-empty thinking replace the old one', () => {
    expect(mergeMessage(msg({ thinking: 'old' }), msg({ thinking: 'new' })).thinking).toBe('new');
  });

  it('does not invent thinking when neither side has it', () => {
    expect(mergeMessage(msg({}), msg({ text: 'hi' })).thinking).toBeUndefined();
  });

  it('returns the incoming message untouched when there is no previous one', () => {
    const next = msg({ text: 'hi' });
    expect(mergeMessage(undefined, next)).toBe(next);
  });
});
