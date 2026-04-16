import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AppLogo } from "./AppLogo";

const PHRASES = [
  "A afundar os tentáculos no teclado…",
  "A preparar uma resposta bem profunda…",
  "O Zé Polvinho está a servir — com todo o cuidado.",
  "A mexer nas teclas certas para si…",
  "Quase lá — falta só o último toque.",
  "A processar o seu pedido com dedicação.",
  "O polvo está a aquecer o motor… mental.",
  "A escrever devagar para não borrar o ecrã.",
  "A puxar fios… digo, contexto, no motor Go.",
  "A regar as ideias antes de as servir.",
] as const;

type Props = {
  active: boolean;
};

/** Loader retro no corpo do chat (estilo bolha do assistente), sem modal. */
export function OctopusTypingLoader({ active }: Props) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % PHRASES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (active) setPhraseIndex(0);
  }, [active]);

  if (!active) return null;

  return (
    <div
      className={cn(
        "max-w-[min(92%,560px)] self-start overflow-hidden rounded-2xl border-2 border-border",
        "bg-[#0d0d0d] p-4 font-mono text-xs text-[#9fdf9f] shadow-md",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-[0.06] before:content-['']",
        "before:bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,0,0,0.5)_2px,rgba(0,0,0,0.5)_4px)]",
        "relative",
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="A aguardar resposta do Zé Polvinho"
    >
      <p className="mb-3 border-b border-[#c45c4a]/40 pb-2 text-[10px] uppercase tracking-[0.2em] text-[#e8a090]">
        Zé Polvinho · a digitar
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex shrink-0 flex-col items-center">
          <AppLogo
            className="h-24 w-24 [transform-origin:center_bottom] drop-shadow-[0_3px_0_#000] sm:h-28 sm:w-28"
            style={{
              animation: "retro-octopus-body 0.75s ease-in-out infinite",
            }}
            alt=""
          />
          <div
            className="-mt-1 flex gap-0.5 rounded-b border border-t-0 border-[#6b6b6b] bg-[#4a4a4a] px-2 py-1 shadow-[0_3px_0_#222]"
            aria-hidden
          >
            {Array.from({ length: 8 }, (_, k) => (
              <span
                key={k}
                className="h-2 w-2.5 rounded-[1px] bg-[#2a2a2a] shadow-[inset_0_-1px_0_#111] sm:h-2.5 sm:w-3"
                style={{
                  animation: "retro-key-hit 0.5s ease-in-out infinite",
                  animationDelay: `${k * 0.07}s`,
                }}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] text-[#6c6]">
            <span className="inline-block animate-pulse">▓</span> a processar…
          </p>
          <p className="leading-relaxed text-[#b8e8b8]">{PHRASES[phraseIndex]}</p>
        </div>
      </div>
    </div>
  );
}
