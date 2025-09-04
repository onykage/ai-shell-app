import OpenAI from 'openai'

let client: OpenAI | null = null

export function initOpenAI(apiKey?: string) {
  if (!apiKey) return
  client = new OpenAI({ apiKey })
}

export async function aiComplete(prompt: string, system = 'You are a helpful coding assistant.') {
  if (!client) throw new Error('OpenAI not configured')
  // Basic Responses API call: adjust model as needed
  const res = await client.responses.create({
    model: 'gpt-4.1-mini',
    input: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ]
  })
  // Normalize text output
  const text = res.output_text ?? ''
  return text
}
