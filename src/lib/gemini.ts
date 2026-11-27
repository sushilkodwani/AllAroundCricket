// A thin client for Google's Gemini API (generateContent). One question in, one
// answer out; every failure becomes a short sentence an admin can act on.
// Google retires models (gemini-2.5-flash is gone for new keys), so a busy or retired model falls back to the next.
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite'
export const FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-flash-latest']
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_MS = 80_000

export interface AskInput {
  key: string
  model: string
  system: string
  prompt: string
  /** For tests. */
  fetcher?: typeof fetch
}

interface GeminiBody {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  error?: { code?: number; message?: string; status?: string }
}

/** Turns a failed call into a message for the admin. */
export function explainFailure(status: number, body: GeminiBody | null): string {
  const reason = body?.error?.status ?? ''
  const text = body?.error?.message ?? ''
  if (status === 400 && /api key|API_KEY/i.test(text + reason)) return 'The Gemini key was not accepted. Ask the super admin to check it in Settings → AI reports.'
  if (status === 400 && /model/i.test(text)) return 'Gemini does not know this model name. Ask the super admin to check it in Settings → AI reports.'
  if (status === 401 || status === 403) return 'The Gemini key is not allowed to do this. Ask the super admin to check it in Settings → AI reports.'
  if (status === 404) return 'Gemini does not know this model name. Ask the super admin to check it in Settings → AI reports.'
  if (status === 429) return 'The free Gemini limit has been reached for now. Try again in a few minutes (or tomorrow if the daily limit is used up).'
  if (status >= 500) return 'Gemini is busy right now. Try again in a minute.'
  return `Gemini could not answer (${status}). Try again in a minute.`
}

/** Pulls the answer text out of a Gemini response, or throws why there is none. */
export function textOf(body: GeminiBody): string {
  if (body.promptFeedback?.blockReason) throw new Error('Gemini declined to answer this one. Try again.')
  const cand = body.candidates?.[0]
  const text = (cand?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error(cand?.finishReason === 'MAX_TOKENS' ? 'The answer was cut short. Try again.' : 'Gemini sent back an empty answer. Try again.')
  return text
}

async function askOne(input: AskInput): Promise<string> {
  const doFetch = input.fetcher ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await doFetch(`${ENDPOINT}/${encodeURIComponent(input.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 16384 },
      }),
      signal: ctl.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Gemini took too long to answer. Try again.')
    throw new Error('Could not reach Gemini. Check the internet connection and try again.')
  } finally {
    clearTimeout(timer)
  }
  const body = (await res.json().catch(() => null)) as GeminiBody | null
  if (!res.ok) throw new Error(explainFailure(res.status, body))
  return textOf(body ?? {})
}

/** True when trying another model may help: the model is gone, or Google is busy. */
const worthSwitching = (e: Error) => /does not know this model|busy right now|took too long/.test(e.message)

/** Asks the chosen model; if it is retired or busy (after one retry), tries the fallbacks. */
export async function askGemini(input: AskInput): Promise<string> {
  const chain = [input.model, ...FALLBACK_MODELS.filter((m) => m !== input.model)]
  let last: Error | null = null
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await askOne({ ...input, model })
      } catch (e) {
        last = e as Error
        if (!worthSwitching(last)) throw last
        // A busy model gets one more try after a pause; a retired one goes straight to the next.
        if (!/busy right now/.test(last.message)) break // retired or too slow: next model
        if (!input.fetcher) await new Promise((r) => setTimeout(r, 4000))
      }
    }
  }
  throw last ?? new Error('Gemini could not answer.')
}
