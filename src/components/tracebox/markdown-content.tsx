import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { tokenizeCommentBody } from "@/lib/issues";
import { cn } from "@/lib/utils";

function enhanceText(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return tokenizeCommentBody(children).map((token, index) => {
      if (token.kind === "mention") return <span key={index} className="rounded bg-primary/10 px-1 py-0.5 font-medium text-primary">{token.text}</span>;
      if (token.kind === "issue-ref") return <Link key={index} href={`/dashboard/issues/${token.text}`} className="font-mono text-xs font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{token.text}</Link>;
      return <Fragment key={index}>{token.text}</Fragment>;
    });
  }
  if (Array.isArray(children)) return children.map((child, index) => <Fragment key={index}>{enhanceText(child)}</Fragment>);
  return children;
}

export function MarkdownContent({ body, className }: { body: string; className?: string }) {
  return <div className={cn("space-y-3 break-words text-sm leading-6", className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="mt-5 text-xl font-semibold">{enhanceText(children)}</h1>,
        h2: ({ children }) => <h2 className="mt-4 text-lg font-semibold">{enhanceText(children)}</h2>,
        h3: ({ children }) => <h3 className="mt-3 text-base font-semibold">{enhanceText(children)}</h3>,
        p: ({ children }) => <p>{enhanceText(children)}</p>,
        ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
        li: ({ children }) => <li>{enhanceText(children)}</li>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">{children}</a>,
        code: ({ className: codeClass, children }) => codeClass ? <code className={cn("block overflow-x-auto rounded-md border border-border/80 bg-background/80 p-3 font-mono text-xs", codeClass)}>{children}</code> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
        pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
        table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
        th: ({ children }) => <th className="border border-border/80 bg-muted/50 px-2 py-1 text-left font-semibold">{enhanceText(children)}</th>,
        td: ({ children }) => <td className="border border-border/70 px-2 py-1 align-top">{enhanceText(children)}</td>,
        hr: () => <hr className="border-border/80" />,
      }}
    >{body}</ReactMarkdown>
  </div>;
}
