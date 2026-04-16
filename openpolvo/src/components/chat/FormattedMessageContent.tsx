import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Props = {
  content: string;
  className?: string;
  /** Mensagens do assistente: Markdown + GFM. Utilizador: texto simples. */
  variant?: "rich" | "plain";
};

const markdownComponents: Components = {
  a: ({ href, children, ...rest }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/90"
      {...rest}
    >
      {children}
    </a>
  ),
};

export function FormattedMessageContent({
  content,
  className,
  variant = "rich",
}: Props) {
  if (variant === "plain") {
    return (
      <div className={cn("whitespace-pre-wrap break-words", className)}>
        {content}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "prose prose-sm max-w-none break-words text-inherit dark:prose-invert",
        "prose-headings:mb-2 prose-headings:mt-3 prose-headings:font-semibold prose-headings:tracking-tight first:prose-headings:mt-0",
        "prose-p:my-1.5 prose-p:leading-relaxed",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-inherit prose-code:rounded-md prose-code:bg-muted/90 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-muted/50 prose-pre:text-[0.85rem]",
        "prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground",
        "prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2",
        "prose-table:block prose-table:overflow-x-auto",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
