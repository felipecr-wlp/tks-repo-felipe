/**
 * POST /api/ai/text
 * Reescribe un fragmento de texto con Gemini Flash: mejorar, corregir gramatica,
 * acortar, resumir o ampliar. Lo usa el boton de IA del editor de Notas.
 *
 * A diferencia de KERN, esto NO conversa ni tiene herramientas: entra texto,
 * sale texto. Por eso no acepta historial ni system prompt del cliente, solo
 * una accion de una lista cerrada. El unico texto libre es el fragmento a
 * transformar, y va como CONTENIDO, nunca como instruccion.
 *
 * Auth: requiere sesion. Sin ella, 401.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { geminiFlash, AI_PROMPTS } from '@/lib/ai/client'
import { applyRateLimit } from '@/lib/rate-limit'

// Solo las acciones que operan sobre un texto existente. `generateSubtasks` y
// `generateDescription` viven en el mundo de las tareas, no en el editor.
const ACTIONS = ['improve', 'grammar', 'concise', 'summarize', 'expand'] as const
type EditorAction = (typeof ACTIONS)[number]

const bodySchema = z
  .object({
    action: z.enum(ACTIONS),
    // 8000 caracteres es como cinco paginas. Mas que eso ya no es "arreglame
    // este parrafo" y el modelo devuelve un refrito, ademas de costar de mas.
    text: z.string().trim().min(1).max(8000),
  })
  .strict()

export const maxDuration = 30

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'ai')
  if (limited) return limited

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const key = process.env.GEMINI_API_KEY
  if (!key || key.startsWith('AIza...') || key.length < 20) {
    return NextResponse.json(
      { error: 'La IA no está configurada: falta una GEMINI_API_KEY válida en el servidor.' },
      { status: 503 }
    )
  }

  let parsed: { action: EditorAction; text: string }
  try {
    const result = bodySchema.safeParse(await request.json())
    if (!result.success) {
      return NextResponse.json({ error: 'Texto o acción inválidos' }, { status: 422 })
    }
    parsed = result.data
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  try {
    const { text } = await generateText({
      model: geminiFlash,
      prompt: AI_PROMPTS[parsed.action](parsed.text),
      // Bajo a proposito: se pide reescribir lo que ya existe, no inventar.
      temperature: 0.4,
    })

    const out = text.trim()
    if (!out) {
      return NextResponse.json({ error: 'La IA no devolvió texto.' }, { status: 502 })
    }
    return NextResponse.json({ text: out })
  } catch (err) {
    console.error('[ai/text] error:', err)
    return NextResponse.json({ error: 'No se pudo procesar el texto.' }, { status: 500 })
  }
}
