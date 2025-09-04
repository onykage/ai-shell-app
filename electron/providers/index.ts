import { aiComplete as openaiComplete, initOpenAI } from './openai.js'

type Provider = 'openai'
let current: Provider = 'openai'

export function initProvider(opts: { provider?: Provider; openaiKey?: string }) {
  current = opts.provider ?? 'openai'
  initOpenAI(opts.openaiKey)
}

export async function complete(prompt: string) {
  return openaiComplete(prompt)
}
