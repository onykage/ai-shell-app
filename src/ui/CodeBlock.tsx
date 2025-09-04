import React from 'react'

export default function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  return (
    <pre className="codeblock">
      <code className={`language-${lang}`}>{code}</code>
    </pre>
  )
}
