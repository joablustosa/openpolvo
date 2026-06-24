import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LlmProfileDTO } from "@/lib/llmProfilesApi";
import { formatLlmSelectLabel } from "@/lib/llmRouting";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onValueChange: (v: string) => void;
  profiles: LlmProfileDTO[];
  disabled?: boolean;
  /** Inclui Ollama (local) — activo no Desk MVP */
  showOllama?: boolean;
  /** Estilo compacto para a barra do chat / toolbar Desk */
  compact?: boolean;
  className?: string;
};

export function ChatLlmRoutingSelect({
  value,
  onValueChange,
  profiles,
  disabled,
  showOllama = false,
  compact,
  className,
}: Props) {
  const withKeys = profiles.filter((p) => p.has_api_key);
  const label = formatLlmSelectLabel(value, profiles);

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
      <SelectTrigger
        size="sm"
        disabled={disabled}
        className={cn(
          compact
            ? "h-7 min-w-[140px] max-w-[240px] border-border/60 bg-background/80 text-[11px]"
            : "h-8 min-w-[160px] max-w-[280px] text-xs",
          className,
        )}
        aria-label="Modelo e perfil LLM"
      >
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[var(--anchor-width)]">
        <SelectGroup>
          <SelectLabel className="text-[10px]">Modo</SelectLabel>
          {showOllama ? (
            <SelectItem value="ollama">Ollama (local)</SelectItem>
          ) : null}
          <SelectItem value="auto">Automático</SelectItem>
          <SelectItem value="openai">OpenAI (sem perfil)</SelectItem>
          <SelectItem value="google">Gemini (sem perfil)</SelectItem>
        </SelectGroup>
        {withKeys.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="text-[10px]">Perfis com chave</SelectLabel>
              {withKeys.map((p) => (
                <SelectItem key={p.id} value={`p:${p.id}`}>
                  {p.display_name} · {p.model_id} (
                  {p.provider === "google" ? "Gemini" : "OpenAI"})
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}
