'use client'

import { useEffect, useRef, useState } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const GREETING =
  "Hi — I'm the Autoura concierge. I work with tour operators and DMCs to see if Autoura fits how you quote today. To start: what are you running quoting on right now — WhatsApp + Excel, another system, or nothing formal yet?"

export default function ChatWidget() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: GREETING },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    setError(null)
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: text,
          pageUrl: typeof document !== 'undefined' ? document.referrer || window.location.href : undefined,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Request failed')
      }

      const data = await res.json()
      setConversationId(data.conversationId)
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError((err as Error).message)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "Sorry — I hit a problem sending that. Please try again in a moment.",
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-warm-200 bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-black/5 bg-brand px-4 py-3 text-white">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          A
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Autoura concierge</div>
          <div className="text-xs text-white/80 leading-tight">Built by operators, for operators</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-warm-50 px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-sm bg-brand text-white'
                  : 'rounded-bl-sm border border-warm-200 bg-white text-warm-800'
              }`}
            >
              {linkify(m.content)}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-warm-200 bg-white px-3.5 py-2.5 text-sm text-warm-400">
              <span className="inline-flex gap-1">
                <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-warm-200 bg-white p-3">
        {error && <div className="mb-2 text-xs text-red-500">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Type your message…"
            className="max-h-28 flex-1 resize-none rounded-xl border border-warm-300 px-3 py-2 text-sm text-warm-800 placeholder:text-warm-400 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 hover:bg-brand-dark"
          >
            Send
          </button>
        </div>
        <div className="mt-2 text-center text-[10px] text-warm-500">
          Answers reflect Autoura&apos;s current product. Anything unconfirmed is flagged for the team.
        </div>
      </div>
    </div>
  )
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-warm-400"
      style={{ animationDelay: delay }}
    />
  )
}

// Render Calendly / http links as clickable anchors; everything else as text.
function linkify(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s*]+)/g)
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}
