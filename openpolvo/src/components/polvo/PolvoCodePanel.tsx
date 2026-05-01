import { Code2 } from "lucide-react";
import { isElectron } from "@/lib/desktopApi";
import { PolvoCodeWorkbench } from "@/components/polvo/polvo-code/PolvoCodeWorkbench";

type Props = {
  onClose?: () => void;
};

export function PolvoCodePanel({ onClose }: Props) {
  if (!isElectron()) {
    return (
      <section
        className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-muted/20 p-6 text-center text-sm text-muted-foreground"
        aria-label="Polvo Code"
      >
        <Code2 className="size-10 opacity-50" />
        <p className="max-w-md">
          O modo <strong className="text-foreground">Polvo Code</strong> (IDE integrado +
          terminal) está disponível na aplicação{" "}
          <strong className="text-foreground">desktop</strong> (Electron).
        </p>
      </section>
    );
  }

  return <PolvoCodeWorkbench onClose={onClose} />;
}
