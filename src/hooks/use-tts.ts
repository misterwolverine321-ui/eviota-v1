import { useCallback, useEffect, useRef, useState } from "react";
import { clampRate, pickVoice, segmentSentences, type TtsPosition } from "@/lib/tts";

export type { TtsPosition };

/**
 * Where the spoken text comes from. `unit` is the 1-based index the engine
 * uses for `extractPageText` (a PDF page, a foliate section, 1 for a
 * single-document engine).
 */
export interface TtsSource {
  unit: number;
  unitCount: number;
  getText: (unit: number) => Promise<string>;
  /** Bring the reading surface to a unit when speech rolls into it. */
  goToUnit?: (unit: number) => void;
  /** Document language, used to pick a default voice. */
  lang?: string | null;
}

export interface TtsController {
  supported: boolean;
  /** Speech is loaded and playing or paused — the caption bar is visible. */
  active: boolean;
  paused: boolean;
  loading: boolean;
  /** Sentence currently being spoken. */
  caption: string | null;
  /** Position inside the current unit, 0..1. */
  progress: number;
  voices: { name: string; lang: string }[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
}

/**
 * Sentence-at-a-time `speechSynthesis` driver.
 *
 * One utterance is in flight at any moment: chunking keeps the platform from
 * choking on long text, makes pause/skip instant, and gives us the spoken
 * sentence for the caption bar. When a unit runs out we ask the engine to move
 * on and keep speaking.
 */
export function useTts({
  rate,
  voiceName,
  source,
  restore,
  onPosition,
}: {
  rate: number;
  voiceName?: string | null;
  source: TtsSource;
  /** Where a fresh `play()` should resume from, if a position was stored. */
  restore?: TtsPosition | null;
  /** Fires as each sentence starts, so the caller can persist the position. */
  onPosition?: (position: TtsPosition) => void;
}): TtsController {
  const supported = typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  /** Latest source/settings, readable from utterance callbacks. */
  const srcRef = useRef(source);
  srcRef.current = source;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const voiceRef = useRef(voiceName ?? null);
  voiceRef.current = voiceName ?? null;
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  voicesRef.current = voices;
  const restoreRef = useRef(restore ?? null);
  restoreRef.current = restore ?? null;
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  /** Consumed once per session: resuming should not fight manual skips. */
  const restoreUsedRef = useRef(false);

  const sentencesRef = useRef<string[]>([]);
  const indexRef = useRef(0);
  const unitRef = useRef(source.unit);
  /** Incremented by stop() so stale utterance callbacks are ignored. */
  const runRef = useRef(0);
  const activeRef = useRef(false);

  // Voice lists populate asynchronously on most platforms.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const read = () => setVoices(synth.getVoices());
    read();
    synth.addEventListener?.("voiceschanged", read);
    return () => synth.removeEventListener?.("voiceschanged", read);
  }, [supported]);

  const hardStop = useCallback(() => {
    runRef.current++;
    restoreUsedRef.current = false;
    activeRef.current = false;
    sentencesRef.current = [];
    indexRef.current = 0;
    if (supported) window.speechSynthesis.cancel();
    setActive(false);
    setPaused(false);
    setLoading(false);
    setCaption(null);
    setProgress(0);
  }, [supported]);

  // Never leave a voice talking after the reader unmounts.
  useEffect(() => hardStop, [hardStop]);

  /** Speak sentence `i` of the loaded unit, then chain onward. */
  const speak = useCallback(
    (i: number, run: number) => {
      if (!supported || run !== runRef.current) return;
      const list = sentencesRef.current;
      if (i >= list.length) {
        void advanceRef.current(run);
        return;
      }
      indexRef.current = i;
      const text = list[i];
      onPositionRef.current?.({ unit: unitRef.current, index: i });
      setCaption(text);
      setProgress(list.length ? (i + 1) / list.length : 0);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = clampRate(rateRef.current);
      const voice = pickVoice(voicesRef.current, voiceRef.current, srcRef.current.lang);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else if (srcRef.current.lang) {
        utterance.lang = srcRef.current.lang;
      }
      utterance.onend = () => {
        if (run !== runRef.current) return;
        speak(i + 1, run);
      };
      utterance.onerror = () => {
        if (run !== runRef.current) return;
        // A failed utterance shouldn't end the session; skip past it.
        speak(i + 1, run);
      };
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  /** Load a unit's text and start speaking it. Returns false when empty. */
  const loadAndSpeak = useCallback(
    async (unit: number, run: number, startIndex = 0): Promise<boolean> => {
      setLoading(true);
      let text = "";
      try {
        text = await srcRef.current.getText(unit);
      } catch {
        text = "";
      }
      if (run !== runRef.current) return false;
      setLoading(false);
      const list = segmentSentences(text);
      sentencesRef.current = list;
      unitRef.current = unit;
      if (!list.length) return false;
      const start = Math.min(Math.max(0, startIndex), list.length - 1);
      indexRef.current = start;
      speak(start, run);
      return true;
    },
    [speak],
  );

  /** Roll into the next unit, skipping empty ones. */
  const advance = useCallback(
    async (run: number) => {
      const src = srcRef.current;
      let unit = unitRef.current;
      while (run === runRef.current && unit < src.unitCount) {
        unit++;
        src.goToUnit?.(unit);
        if (await loadAndSpeak(unit, run)) return;
      }
      if (run === runRef.current) hardStop();
    },
    [hardStop, loadAndSpeak],
  );
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const play = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    if (activeRef.current && synth.paused) {
      synth.resume();
      setPaused(false);
      return;
    }
    if (activeRef.current && synth.speaking) return;
    const run = ++runRef.current;
    activeRef.current = true;
    setActive(true);
    setPaused(false);
    synth.cancel();
    // A stored position only steers the first play of a session; after that
    // the live cursor wins so skips and stops are not undone.
    const target = restoreUsedRef.current ? null : restoreRef.current;
    restoreUsedRef.current = true;
    void (async () => {
      const src = srcRef.current;
      let unit = src.unit;
      let index = 0;
      if (target) {
        unit = Math.min(Math.max(1, Math.floor(target.unit)), Math.max(1, src.unitCount));
        index = Math.max(0, Math.floor(target.index));
        if (unit !== src.unit) src.goToUnit?.(unit);
      }
      const started = await loadAndSpeak(unit, run, index);
      if (!started && run === runRef.current) await advanceRef.current(run);
    })();
  }, [loadAndSpeak, supported]);

  const pause = useCallback(() => {
    if (!supported || !activeRef.current) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [supported]);

  const toggle = useCallback(() => {
    if (activeRef.current && !window.speechSynthesis.paused) pause();
    else play();
  }, [pause, play]);

  const skip = useCallback(
    (delta: number) => {
      if (!supported || !activeRef.current) return;
      const target = indexRef.current + delta;
      const run = ++runRef.current;
      window.speechSynthesis.cancel();
      setPaused(false);
      if (target < 0) {
        speak(0, run);
        return;
      }
      if (target >= sentencesRef.current.length) {
        void advanceRef.current(run);
        return;
      }
      speak(target, run);
    },
    [speak, supported],
  );

  return {
    supported,
    active,
    paused,
    loading,
    caption,
    progress,
    voices: voices.map((v) => ({ name: v.name, lang: v.lang })),
    play,
    pause,
    toggle,
    stop: hardStop,
    next: () => skip(1),
    prev: () => skip(-1),
  };
}
