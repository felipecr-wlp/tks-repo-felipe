/**
 * POST /api/kern
 * Endpoint de chat en streaming del asistente KERN (Google Gemini Flash).
 * Recibe el historial de mensajes (formato Vercel AI SDK) y devuelve un stream.
 *
 * Auth: requiere usuario autenticado. Sin sesión → 401.
 */
import { NextRequest, NextResponse } from 'next/server'
import { streamText, type CoreMessage } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { geminiFlash, KERN_SYSTEM_PROMPT } from '@/lib/ai/client'
import { applyRateLimit } from '@/lib/rate-limit'

// El streaming necesita el runtime de Node (no edge) para usar el server client
export const maxDuration = 30

export async function POST(request: NextRequest) {
  // ── Rate limit (degrada con gracia si Upstash no está configurado) ──────────
  const limited = await applyRateLimit(request, 'ai')
  if (limited) return limited

  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // ── Validación de API key ────────────────────────────────────────────────────
  const key = process.env.GEMINI_API_KEY
  if (!key || key.startsWith('AIza...') || key.length < 20) {
    return NextResponse.json(
      { error: 'KERN no está configurado: falta una GEMINI_API_KEY válida en el servidor.' },
      { status: 503 }
    )
  }

  // ── Payload ───────────────────────────────────────────────────────────────────
  let messages: CoreMessage[]
  try {
    const body = await request.json()
    messages = body.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Mensajes inválidos' }, { status: 400 })
    }
    // Topes anti-abuso: KERN corre sobre un LLM de pago. Sin límites, un cliente
    // podría mandar historiales gigantes y disparar el costo (o inyectar prompts
    // enormes). Acotamos cantidad y tamaño total antes de tocar el modelo.
    if (messages.length > 40) {
      return NextResponse.json({ error: 'Conversación demasiado larga' }, { status: 413 })
    }
    const totalChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length),
      0,
    )
    if (totalChars > 24000) {
      return NextResponse.json({ error: 'Mensaje demasiado grande' }, { status: 413 })
    }
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // ── Stream de Gemini ──────────────────────────────────────────────────────────
  try {
    const result = await streamText({
      model: geminiFlash,
      system: KERN_SYSTEM_PROMPT,
      messages,
      temperature: 0.6,
    })

    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[kern] stream error:', err)
    return NextResponse.json(
      { error: 'Error al generar la respuesta de KERN.' },
      { status: 500 }
    )
  }
}
