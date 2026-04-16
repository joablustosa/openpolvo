import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import logoSrc from "@/assets/oficial_logo.png";

type Props = {
  className?: string;
  alt?: string;
  style?: CSSProperties;
};

export function AppLogo({ className, alt = "Open Polvo", style }: Props) {
  return (
    <img
      src={logoSrc}
      alt={alt}
      style={style}
      className={cn(
        "object-contain [image-rendering:pixelated] [image-rendering:-moz-crisp-edges]",
        className,
      )}
    />
  );
}

export const oficialLogoSrc = logoSrc;
