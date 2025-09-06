import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function AssistantMarkdown({ md }: { md: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }) {
          if (inline) {
            return (
              <code className="px-1 py-0.5 rounded bg-neutral-900" {...props}>
                {children}
              </code>
            )
          }
          // Fenced code block — no copy button, no extra wrappers
          return (
            <pre className="overflow-auto rounded border border-neutral-800 p-3">
              <code className={className} {...props}>
                {String(children ?? "").replace(/\n$/, "")}
              </code>
            </pre>
          )
        },
      }}
    >
      {md}
    </ReactMarkdown>
  )
}
