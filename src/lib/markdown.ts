import { marked } from 'marked'

export function renderMarkdown(md: string) {
  return marked.parse(md, { breaks: true }) as string
}
