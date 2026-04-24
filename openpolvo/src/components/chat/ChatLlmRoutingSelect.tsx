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
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onValueChange: (v: string) => void;
  profiles: LlmProfileDTO[];
  disabled?: boolean;
  /** Estilo compacto para a barra do chat */
  compact?: boolean;
  className?: string;
};

export function ChatLlmRoutingSelect({
  value,
  onValueChange,
  profiles,
  disabled,
  compact,
  className,
}: Props) {
  const withKeys = profiles.filter((p) => p.has_api_key);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        disabled={disabled}
        className={cn(
          compact
            ? "h-7 min-w-[140px] max-w-[220px] border-border/60 bg-background/80 text-[11px]"
            : "h-8 min-w-[160px] max-w-[260px] text-xs",
          className,
        )}
        aria-label="Modelo e perfil LLM"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[var(--anchor-width)]">
        <SelectGroup>
          <SelectLabel className="text-[10px]">Modo</SelectLabel>
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
                  {p.display_name} ({p.provider === "google" ? "Gemini" : "OpenAI"})
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}
