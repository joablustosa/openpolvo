import { useCallback, useRef } from "react";

const PREFERRED_MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];

function pickMime(): string {
  for (const t of PREFERRED_MIME) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

export type RecordUntilSilenceOptions = {
  speechThreshold?: number;
  silenceMs?: number;
  maxWaitFirstSpeechMs?: number;
  maxAfterSpeechMs?: number;
  warmupMs?: number;
};

/**
 * Grava até silêncio estável após fala, ou até limites de tempo.
 */
export function useRecordUntilSilence() {
  const abortRef = useRef<(() => void) | null>(null);

  const record = useCallback(async (opts?: RecordUntilSilenceOptions): Promise<Blob> => {
    const speechThreshold = opts?.speechThreshold ?? 0.028;
    const silenceMs = opts?.silenceMs ?? 1700;
    const maxWaitFirst = opts?.maxWaitFirstSpeechMs ?? 14000;
    const maxAfterSpeech = opts?.maxAfterSpeechMs ?? 42000;
    const warmupMs = opts?.warmupMs ?? 220;

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
    let done = false;
    let rejectReason: string | null = null;

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
      abortRef.current = null;
    };

    abortRef.current = () => {
      if (done) return;
      rejectReason = "cancelado";
      done = true;
      try {
        recorder.stop();
      } catch {
        teardownStreams();
      }
    };

    return new Promise<Blob>((resolve, reject) => {
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
            fail("Não foi detectada voz após «jow na escuta?»");
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
        recorder.start(120);
        raf = requestAnimationFrame(tick);
      } catch (e) {
        done = true;
        teardownStreams();
        reject(e instanceof Error ? e : new Error("MediaRecorder"));
      }
    });
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.();
  }, []);

  return { record, abort };
}
