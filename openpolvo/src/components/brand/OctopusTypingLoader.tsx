import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLogo } from "./AppLogo";

type Props = {
  active: boolean;
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    // Mostra décimas no primeiro minuto para dar sensação de progresso.
    const tenths = Math.floor((ms % 1000) / 100);
    return `${totalSeconds}.${tenths}s`;
  }
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Loader minimalista estilo Claude: polvo pequeno a flutuar + 3 pontinhos
 * + contador de tempo decorrido. Aparece inline como bolha do assistente.
 */
export function OctopusTypingLoader({ active }: Props) {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    startRef.current = performance.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      if (startRef.current != null) {
        setElapsed(performance.now() - startRef.current);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div
      className={cn(
        "inline-flex max-w-fit items-center gap-2 self-start",
        "rounded-full border border-border bg-card/70 px-3 py-1.5",
        "text-xs text-muted-foreground shadow-sm backdrop-blur-sm",
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="O Zé Polvinho está a pensar"
    >
      <AppLogo
        className="size-6 shrink-0"
        style={{
          animation: "polvo-float 1.8s ease-in-out infinite",
          transformOrigin: "center",
        }}
        alt=""
      />

      <span className="flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block size-1 rounded-full bg-foreground/70"
            style={{
              animation: "polvo-dot 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </span>

      <span className="tabular-nums text-[11px] text-muted-foreground/80">
        {formatElapsed(elapsed)}
      </span>
    </div>
  );
}
