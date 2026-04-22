import { useEffect, useRef, useState } from "react";
import { containsWakePhrase, isSpeechRecognitionSupported, textAfterWakePhrase } from "@/lib/voiceWake";

const STORAGE_KEY = "openpolvo_voice_wake_jow";

export type WakePayload =
  | { kind: "inline"; text: string }
  | { kind: "record" };

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function fullTranscript(ev: SpeechRecognitionEvent): string {
  let s = "";
  for (let i = 0; i < ev.results.length; i++) {
    s += ev.results[i]?.[0]?.transcript ?? "";
  }
  return s.trim();
}

/**
 * Escuta contínua (Web Speech API). Chama `onWake` **antes** de parar o motor,
 * para o pai poder marcar estado «ocupado» e evitar reinícios concorrentes.
 */
export function useJowWakeListener(options: {
  active: boolean;
  onWake: (payload: WakePayload) => void;
}) {
  const { active, onWake } = options;
  const [supported] = useState(() => isSpeechRecognitionSupported());
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const recRef = useRef<SpeechRecognition | null>(null);
  const lastFireRef = useRef(0);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;
  const activeRef = useRef(active);
  activeRef.current = active;
  const restartTimerRef = useRef<number | null>(null);
  const useLongRestartRef = useRef(false);

  useEffect(() => {
    if (!supported || !active) {
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      recRef.current = null;
      setListening(false);
      setSpeechError(null);
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    let cancelled = false;

    /** Erros frequentes e transitórios (Chromium) — não mostrar ao utilizador. */
    const isBenignSpeechError = (code: string) =>
      code === "aborted" ||
      code === "no-speech" ||
      code === "network" ||
      code === "interrupted" ||
      code === "service-not-allowed";

    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "pt-PT";
      rec.maxAlternatives = 1;

      rec.onresult = (ev: SpeechRecognitionEvent) => {
        if (cancelled || !activeRef.current) return;
        const full = fullTranscript(ev);
        if (!containsWakePhrase(full)) return;

        const now = Date.now();
        if (now - lastFireRef.current < 2200) return;
        lastFireRef.current = now;

        const after = textAfterWakePhrase(full);
        if (after.length >= 2) {
          onWakeRef.current({ kind: "inline", text: after });
        } else {
          onWakeRef.current({ kind: "record" });
        }

        try {
          rec.stop();
        } catch {
          /* noop */
        }
      };

      rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
        if (cancelled) return;
        const code = ev.error || "";
        if (code === "network" || code === "service-not-allowed") {
          useLongRestartRef.current = true;
        }
        if (isBenignSpeechError(code)) return;
        setSpeechError(ev.message?.trim() || code || "Erro de reconhecimento de voz");
      };

      rec.onend = () => {
        if (cancelled) return;
        setListening(false);
        recRef.current = null;
        if (restartTimerRef.current != null) {
          window.clearTimeout(restartTimerRef.current);
        }
        const delay = useLongRestartRef.current ? 2200 : 400;
        useLongRestartRef.current = false;
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          if (activeRef.current && !cancelled) {
            setRestartKey((k) => k + 1);
          }
        }, delay);
      };

      recRef.current = rec;
      rec.start();
      setListening(true);
      setSpeechError(null);
    } catch (e) {
      setSpeechError(e instanceof Error ? e.message : "SpeechRecognition");
      setListening(false);
    }

    return () => {
      cancelled = true;
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      recRef.current = null;
      setListening(false);
    };
  }, [active, supported, restartKey]);

  const stop = () => {
    if (restartTimerRef.current != null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recRef.current?.abort();
    } catch {
      /* noop */
    }
    recRef.current = null;
    setListening(false);
  };

  return {
    supported,
    listening,
    speechError,
    stop,
  };
}

export function readVoiceWakePreference(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function writeVoiceWakePreference(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* noop */
  }
}
