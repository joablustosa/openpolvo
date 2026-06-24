import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DeskModelProvider } from "@/lib/deskContext";
import { cn } from "@/lib/utils";

const ALL_OPTIONS: { value: DeskModelProvider; label: string }[] = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Gemini" },
  { value: "auto", label: "Automático" },
];

const CLOUD_VALUES = new Set<DeskModelProvider>(["openai", "anthropic", "google"]);

function deskModelOptions(): typeof ALL_OPTIONS {
  const allowCloud = import.meta.env.VITE_DESK_ALLOW_CLOUD_PROVIDERS === "true";
  if (allowCloud) return ALL_OPTIONS;
  return ALL_OPTIONS.filter((o) => !CLOUD_VALUES.has(o.value));
}

type Props = {
  value: DeskModelProvider;
  onValueChange: (v: DeskModelProvider) => void;
  disabled?: boolean;
  className?: string;
};

export function DeskModelSelect({ value, onValueChange, disabled, className }: Props) {
  const options = deskModelOptions();
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const next = (v ?? "ollama") as DeskModelProvider;
        onValueChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        disabled={disabled}
        className={cn("h-7 min-w-[140px] max-w-[200px] text-[11px]", className)}
        aria-label="Modelo LLM"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
