import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  // Tag <webview> do Electron (renderer)
  interface HTMLWebViewElement extends HTMLElement {
    src: string;
    partition?: string;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<HTMLWebViewElement> & {
          src?: string;
          partition?: string;
          allowpopups?: string;
          useragent?: string;
          httpreferrer?: string;
        },
        HTMLWebViewElement
      >;
    }
  }
}

export {};
