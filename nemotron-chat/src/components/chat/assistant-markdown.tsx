import { useState, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 opacity-70 group-hover:opacity-100"
      onClick={copy}
      aria-label="Copy code"
      data-testid="button-copy-code"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className ?? "");
  const isBlock = Boolean(match);

  if (!isBlock) {
    return (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    );
  }

  const text = String(children).replace(/\n$/, "");

  return (
    <div className="group relative my-3 overflow-hidden border border-border bg-muted/30">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[10px] font-mono uppercase text-muted-foreground">
          {match![1]}
        </span>
        <CopyCodeButton text={text} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={cn(className, "font-mono")} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

type AssistantMarkdownProps = {
  content: string;
  isStreaming?: boolean;
};

export function AssistantMarkdown({ content, isStreaming }: AssistantMarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-invert prose-sm max-w-none",
        "prose-headings:font-mono prose-headings:font-semibold prose-headings:text-foreground",
        "prose-p:my-2 prose-p:leading-relaxed",
        "prose-strong:text-foreground prose-em:text-foreground",
        "prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-table:text-sm prose-th:border prose-td:border prose-th:px-2 prose-td:px-2",
        "prose-a:text-primary prose-a:underline",
        "[&_pre]:my-0 [&_pre]:bg-transparent [&_pre]:p-0",
        "font-sans text-sm text-foreground min-w-0"
      )}
      data-testid="assistant-markdown"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span className="inline-block w-0.5 h-4 bg-current animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  );
}
