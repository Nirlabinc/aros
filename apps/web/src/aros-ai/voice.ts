/* eslint-disable @typescript-eslint/no-explicit-any */
// Voice for the AROS chat surfaces: browser Web Speech dictation into the same send path as typing,
// optional hands-free (each final utterance auto-sends), and speak-replies TTS with STT<->TTS
// coordination (the mic is paused while the assistant speaks so it never hears/re-sends its own
// reply). Gracefully inert where the Web Speech API is unavailable, and a no-op on the server.
import { useCallback, useEffect, useRef, useState } from 'react';

function getSR(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

/** Speak assistant text (markdown-stripped, capped). onEnd fires when speech finishes, errors, or
 *  is unavailable — so callers can safely resume the mic afterward. Never throws. */
function speakWithEnd(text: string, onEnd: () => void): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) ||
        typeof SpeechSynthesisUtterance === 'undefined' || !text) { onEnd(); return; }
    const clean = cleanForSpeech(text);
    if (!clean) { onEnd(); return; }
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = navigator.language || 'en-US';
    let done = false;
    const finish = () => { if (!done) { done = true; onEnd(); } };
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { onEnd(); }
}

/** Fire-and-forget speak (no coordination). Prefer the hook's `speak` inside voice mode. */
export function speak(text: string): void {
  speakWithEnd(text, () => { /* no-op */ });
}

export function cancelSpeech(): void {
  try { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

export interface Composed {
  /** what the composer should now display */
  value: string;
  /** a line to auto-send (hands-free finals), or null */
  send: string | null;
  /** carry-over base for the next recognition event */
  nextBase: string;
}

/**
 * Pure transcript composition (unit-tested). Non-hands-free finals accumulate into the base;
 * hands-free finals within one event are joined into a single send (so no segment is dropped).
 */
export function composeFromResults(
  base: string,
  results: { transcript: string; isFinal: boolean }[],
  handsFree: boolean,
): Composed {
  let b = base;
  let interim = '';
  let finals = '';
  for (const res of results) {
    const text = (res.transcript || '').trim();
    if (!text) continue;
    if (res.isFinal) {
      if (handsFree) finals += (finals ? ' ' : '') + text;
      else b += text + ' ';
    } else {
      interim += text + ' ';
    }
  }
  let send: string | null = null;
  if (handsFree && finals) { send = (b + finals).trim(); b = ''; }
  return { value: (b + interim).replace(/\s+$/, ''), send, nextBase: b };
}

export interface VoiceApi {
  supported: boolean;
  listening: boolean;
  toggleMic: () => void;
  stop: () => void;
  /** Speak a reply with the mic paused for its duration (prevents self-transcription). */
  speak: (text: string) => void;
}

/**
 * Dictation hook. `handsFree` (a live prop) makes each final utterance auto-send via `onSend`.
 * `onSend` may return `false` to signal "not accepted right now" (e.g. a request is in flight);
 * the utterance is then kept in the composer instead of being cleared/dropped.
 */
export function useVoice(opts: {
  handsFree: boolean;
  getInput: () => string;
  setInput: (v: string) => void;
  onSend: (text: string) => boolean | void;
}): VoiceApi {
  const supported = !!getSR();
  const [listening, setListening] = useState(false);

  const recRef = useRef<any>(null);          // the currently-running recognizer (or null)
  const baseRef = useRef('');                // committed text before the current interim
  const intendedRef = useRef(false);         // the user wants voice on
  const pausedRef = useRef(false);           // temporarily suspended (during send + TTS)
  const restartTimer = useRef<any>(null);
  const handsFreeRef = useRef(opts.handsFree);
  const getInputRef = useRef(opts.getInput);
  const onSendRef = useRef(opts.onSend);
  const setInputRef = useRef(opts.setInput);
  useEffect(() => {
    handsFreeRef.current = opts.handsFree;
    getInputRef.current = opts.getInput;
    onSendRef.current = opts.onSend;
    setInputRef.current = opts.setInput;
  });

  const clearRestart = () => { if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; } };
  const detach = (r: any) => { if (r) { r.onresult = null; r.onerror = null; r.onend = null; } };
  const scheduleRestart = (begin: () => void) => {
    clearRestart();
    restartTimer.current = setTimeout(() => {
      restartTimer.current = null;
      if (intendedRef.current && !pausedRef.current && !recRef.current) begin();
    }, 300);
  };

  const begin = useCallback(function begin() {
    const SR = getSR();
    if (!SR) return;
    const cur = getInputRef.current().trim();
    baseRef.current = cur ? cur + ' ' : '';
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    r.onresult = (ev: any) => {
      if (!intendedRef.current || pausedRef.current || recRef.current !== r) return; // ignore late/stale
      const results: { transcript: string; isFinal: boolean }[] = [];
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        results.push({ transcript: ev.results[i][0]?.transcript || '', isFinal: !!ev.results[i].isFinal });
      }
      const { value, send, nextBase } = composeFromResults(baseRef.current, results, handsFreeRef.current);
      baseRef.current = nextBase;
      if (send) {
        const accepted = onSendRef.current(send);
        if (accepted === false) { baseRef.current = send + ' '; setInputRef.current(send); } // keep, don't drop
        else setInputRef.current('');
      } else {
        setInputRef.current(value);
      }
    };
    r.onerror = (e: any) => { if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') stop(); };
    r.onend = () => {
      if (recRef.current !== r) return;
      recRef.current = null;
      if (intendedRef.current && !pausedRef.current) scheduleRestart(begin); // auto-restart after silence
    };
    recRef.current = r;
    try {
      r.start();
    } catch {
      detach(r);
      recRef.current = null;
      if (intendedRef.current && !pausedRef.current) scheduleRestart(begin); // don't get stuck; retry
    }
  }, []);

  const stop = useCallback(() => {
    intendedRef.current = false;
    pausedRef.current = false;
    clearRestart();
    const r = recRef.current;
    recRef.current = null;
    detach(r);
    try { r?.abort ? r.abort() : r?.stop(); } catch { /* ignore */ }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!getSR()) return;
    cancelSpeech();
    intendedRef.current = true;
    pausedRef.current = false;
    setListening(true);
    begin();
  }, [begin]);

  const toggleMic = useCallback(() => { if (intendedRef.current) stop(); else start(); }, [start, stop]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    clearRestart();
    const r = recRef.current;
    recRef.current = null;
    detach(r);
    try { r?.abort ? r.abort() : r?.stop(); } catch { /* ignore */ }
  }, []);

  const resume = useCallback(() => {
    if (!intendedRef.current) return;
    pausedRef.current = false;
    if (!recRef.current) begin();
  }, [begin]);

  // Speak with the mic held: pause recognition, speak, resume when speech ends (if still on).
  const speakCoordinated = useCallback((text: string) => {
    if (intendedRef.current) pause();
    speakWithEnd(text, () => { if (intendedRef.current) resume(); });
  }, [pause, resume]);

  useEffect(() => () => stop(), [stop]); // stop + cleanup on unmount
  return { supported, listening, toggleMic, stop, speak: speakCoordinated };
}
