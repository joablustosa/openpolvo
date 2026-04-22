/** Frase de activação por voz (pt). Aceita variações sem acento. */
export const JOW_WAKE_REGEX = /\bjow\s+na\s+escuta\??/i;

export function containsWakePhrase(text: string): boolean {
  return JOW_WAKE_REGEX.test(text.trim());
}

/** Texto após a frase de activação no mesmo resultado; vazio se não houver. */
export function textAfterWakePhrase(text: string): string {
  return text.replace(/^[\s\S]*?jow\s+na\s+escuta\??\s*/i, "").trim();
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
}
