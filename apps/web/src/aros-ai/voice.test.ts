import { describe, expect, it, vi, beforeEach } from 'vitest';
import { composeFromResults, speak } from './voice';

const r = (transcript: string, isFinal: boolean) => ({ transcript, isFinal });

describe('composeFromResults', () => {
  it('paints interim results into the composer without sending', () => {
    const out = composeFromResults('', [r('show me', false)], false);
    expect(out.value).toBe('show me');
    expect(out.send).toBeNull();
    expect(out.nextBase).toBe('');
  });

  it('accumulates final results into the base when not hands-free', () => {
    const out = composeFromResults('', [r('show todays sales', true)], false);
    expect(out.value).toBe('show todays sales');
    expect(out.send).toBeNull();
    expect(out.nextBase).toBe('show todays sales ');
  });

  it('preserves existing composer text as the base', () => {
    const out = composeFromResults('draft ', [r('more text', false)], false);
    expect(out.value).toBe('draft more text');
  });

  it('auto-sends a final utterance in hands-free mode and resets the base', () => {
    const out = composeFromResults('', [r('reorder milk', true)], true);
    expect(out.send).toBe('reorder milk');
    expect(out.nextBase).toBe('');
    expect(out.value).toBe('');
  });

  it('combines carried base with a hands-free final into one sent line', () => {
    const out = composeFromResults('please ', [r('check inventory', true)], true);
    expect(out.send).toBe('please check inventory');
  });

  it('joins multiple final segments in one event into a single send (no drops)', () => {
    const out = composeFromResults('', [r('reorder', true), r('milk today', true)], true);
    expect(out.send).toBe('reorder milk today');
    expect(out.nextBase).toBe('');
  });

  it('ignores empty transcripts', () => {
    const out = composeFromResults('', [r('   ', false), r('', true)], false);
    expect(out.value).toBe('');
    expect(out.send).toBeNull();
  });
});

describe('speak', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis as unknown as Window;
    (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    };
    (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      class { text: string; lang = ''; constructor(t: string) { this.text = t; } };
  });

  it('strips markdown noise and speaks the cleaned text', () => {
    speak('**Sales** are up. See `report.csv` and [details](http://x).');
    const spy = (globalThis as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis.speak;
    expect(spy).toHaveBeenCalledOnce();
    const spoken = spy.mock.calls[0][0].text as string;
    expect(spoken).toBe('Sales are up. See report.csv and details.');
  });

  it('does nothing for empty text', () => {
    speak('');
    const spy = (globalThis as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis.speak;
    expect(spy).not.toHaveBeenCalled();
  });
});
