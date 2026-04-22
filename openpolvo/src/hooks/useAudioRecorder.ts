import { useCallback, useRef, useState } from "react";

export type AudioRecorderState = "idle" | "recording" | "processing";

const PREFERRED_MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];

function pickMime(): string {
  for (const t of PREFERRED_MIME) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

export type UseAudioRecorderOptions = {
  transcribe: (blob: Blob) => Promise<string>;
  /** Após silêncio ou paragem manual: envia a transcrição como mensagem (fluxo Jarvis). */
  onTranscriptAutoSend?: (text: string) => Promise<void>;
  /** Alternativa: só preenche o rascunho (omitir se usar `onTranscriptAutoSend`). */
  onTranscript?: (text: string) => void;
};

type SilenceOpts = {
  speechThreshold?: number;
  silenceMs?: number;
  maxWaitFirstSpeechMs?: number;
  maxAfterSpeechMs?: number;
  warmupMs?: number;
};

function recordUntilSilenceOrManualStop(
  silence: SilenceOpts,
  stopEarlyRef: { current: boolean },
  recorderOut: { current: MediaRecorder | null },
): Promise<Blob> {
  const speechThreshold = silence.speechThreshold ?? 0.028;
  const silenceMs = silence.silenceMs ?? 1700;
  const maxWaitFirst = silence.maxWaitFirstSpeechMs ?? 14000;
  const maxAfterSpeech = silence.maxAfterSpeechMs ?? 42000;
  const warmupMs = silence.warmupMs ?? 220;

  return (async () => {
    const mimeType = pickMime();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const startedAt = performance.now();
    let firstSpeechAt: number | null = null;
    let silenceSince: number | null = null;

    const teardownStreams = () => {
      if (raf) cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* noop */
      }
      void audioCtx.close();
      recorderOut.current = null;
    };

    return new Promise<Blob>((resolve, reject) => {
      let done = false;
      let rejectReason: string | null = null;

      recorder.onerror = () => {
        if (done) return;
        done = true;
        teardownStreams();
        reject(new Error("Falha na gravação"));
      };

      recorder.onstop = () => {
        if (done) return;
        done = true;
        teardownStreams();
        if (rejectReason) {
          reject(new Error(rejectReason === "cancelado" ? "Gravação cancelada" : rejectReason));
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 220) {
          reject(new Error("Gravação demasiado curta"));
          return;
        }
        resolve(blob);
      };

      const fail = (msg: string) => {
        if (done) return;
        rejectReason = msg;
        try {
          recorder.stop();
        } catch {
          done = true;
          teardownStreams();
          reject(new Error(msg));
        }
      };

      const tick = () => {
        if (done) return;
        const now = performance.now();

        if (stopEarlyRef.current) {
          stopEarlyRef.current = false;
          try {
            recorder.stop();
          } catch {
            fail("Erro ao finalizar gravação");
          }
          return;
        }

        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const loud = rms >= speechThreshold;

        if (now - startedAt < warmupMs) {
          raf = requestAnimationFrame(tick);
          return;
        }

        if (firstSpeechAt === null) {
          if (loud) {
            firstSpeechAt = now;
          } else if (now - startedAt > maxWaitFirst) {
            fail("Não foi detectada voz");
            return;
          }
          raf = requestAnimationFrame(tick);
          return;
        }

        if (now - firstSpeechAt > maxAfterSpeech) {
          try {
            recorder.stop();
          } catch {
            fail("Erro ao finalizar gravação");
          }
          return;
        }

        if (loud) {
          silenceSince = null;
        } else if (silenceSince === null) {
          silenceSince = now;
        } else if (now - silenceSince >= silenceMs) {
          try {
            recorder.stop();
          } catch {
            fail("Erro ao finalizar gravação");
          }
          return;
        }

        raf = requestAnimationFrame(tick);
      };

      try {
        recorderOut.current = recorder;
        recorder.start(120);
        raf = requestAnimationFrame(tick);
      } catch (e) {
        done = true;
        teardownStreams();
        reject(e instanceof Error ? e : new Error("MediaRecorder"));
      }
    });
  })();
}

/**
 * Gravação por voz: detecta fala e termina após silêncio (ou ao clicar de novo no microfone).
 * Depois transcreve na API e chama `onTranscriptAutoSend` ou `onTranscript`.
 */
export function useAudioRecorder(opts: UseAudioRecorderOptions) {
  const [state, setState] = useState<AudioRecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopEarlyRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const busyRef = useRef(false);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      setState("recording");
      const blob = await recordUntilSilenceOrManualStop({}, stopEarlyRef, recorderRef);
      setState("processing");
      const text = (await optsRef.current.transcribe(blob)).trim();
      if (text) {
        const { onTranscriptAutoSend: sendFn, onTranscript: draftFn } = optsRef.current;
        if (sendFn) await sendFn(text);
        else draftFn?.(text);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao transcrever";
      if (msg !== "Gravação cancelada") setError(msg);
    } finally {
      busyRef.current = false;
      setState("idle");
    }
  }, []);

  const requestStop = useCallback(() => {
    stopEarlyRef.current = true;
  }, []);

  const toggle = useCallback(() => {
    if (state === "recording") requestStop();
    else if (state === "idle") void start();
  }, [state, start, requestStop]);

  return { state, error, toggle };
}
