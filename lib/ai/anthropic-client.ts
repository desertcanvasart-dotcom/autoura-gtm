// ============================================================================
// SHARED ANTHROPIC CLIENT WITH RETRY LOGIC
// ============================================================================
// Mirrors autoura-saas/lib/ai/anthropic-client.ts. Single source of truth for
// Anthropic calls; retries transient errors (429/529/500/503) with exponential
// backoff + jitter.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

// Default agent model. Override with GTM_AGENT_MODEL. (The main app pins
// claude-sonnet-4-*, but this workspace serves the Claude 5 family, so the GTM
// service defaults to the latest Sonnet.)
export const AGENT_MODEL = process.env.GTM_AGENT_MODEL || 'claude-sonnet-5'

interface RetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
}

const RETRYABLE_STATUS_CODES = new Set([429, 529, 500, 503])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a message with automatic retry on transient errors.
 * Uses exponential backoff with jitter to avoid a thundering herd.
 */
export async function createMessageWithRetry(
  params: Anthropic.MessageCreateParamsNonStreaming,
  config: Partial<RetryConfig> = {}
): Promise<Anthropic.Message> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_CONFIG, ...config }
  const client = getAnthropicClient()

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params)
    } catch (error) {
      lastError = error
      const status = (error as { status?: number })?.status
      const isRetryable = typeof status === 'number' && RETRYABLE_STATUS_CODES.has(status)

      if (!isRetryable || attempt === maxRetries) {
        throw error
      }

      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
      const jitter = Math.random() * backoff * 0.25
      await sleep(backoff + jitter)
    }
  }

  throw lastError
}
