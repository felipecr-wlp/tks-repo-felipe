/**
 * POST /api/kern
 * Endpoint de chat en streaming del asistente KERN (Google Gemini Flash).
 * Recibe el historial de mensajes (formato Vercel AI SDK) y devuelve un stream.
 *
 * Auth: requiere usuario autenticado. Sin sesión → 401.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { streamText, type CoreMessage } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { geminiFlash, KERN_SYSTEM_PROMPT } from '@/lib/ai/client'
import { buildKernTools, buildKernContext } from '@/lib/ai/kern-tools'
import { applyRateLimit } from '@/lib/rate-limit'

// Estructura del payload de chat. El rol se RESTRINGE a 'user'/'assistant': el cliente
// NO puede mandar un mensaje 'system' (ni 'tool') para inyectar instrucciones y
// secuestrar a KERN (prompt/role injection, CWE-20). El system prompt es del servidor
// y va aparte. Se quedan solo role+content (lo unico que consume streamText); cualquier
// campo extra del AI SDK (id, createdAt, ...) se descarta, sin over-posting. Los techos
// (.max) acotan el consumo de recursos (OWASP API4).
const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.union([z.string().max(24000), z.array(z.unknown()).max(50)]),
      }),
    )
    .min(1)
    .max(100),
})

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
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Mensajes inválidos' }, { status: 400 })
    }
    messages = parsed.data.messages as CoreMessage[]
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

  // ── Contexto + herramientas agenticas ligadas a ESTE usuario ────────────────
  // KERN opera solo sobre datos del usuario: cada herramienta re-verifica su
  // acceso con user.id (mismas reglas que las rutas /api). Se inyecta un resumen
  // de sus proyectos (con ids) para que pueda encadenar lecturas y acciones.
  const admin = createAdminClient()
  const { data: profile } = (await admin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle()) as { data: { display_name: string | null } | null; error: unknown }

  let contextBlock = ''
  try {
    contextBlock = await buildKernContext(admin, user.id, profile?.display_name)
  } catch (ctxErr) {
    console.error('[kern] context build error:', ctxErr)
  }

  // ── Stream de Gemini (con tool calling multi-paso) ──────────────────────────
  try {
    const result = await streamText({
      model: geminiFlash,
      system: KERN_SYSTEM_PROMPT + contextBlock,
      messages,
      temperature: 0.6,
      tools: buildKernTools(admin, user.id),
      // Permite a KERN encadenar herramientas de forma autonoma (ej. list_projects
      // -> create_task) y luego redactar la respuesta final, en una sola vuelta.
      // 8 y no 6 porque escribir un documento gasta pasos extra antes de crear:
      // buscar si ya existe, resolver el departamento y recien ahi create_note.
      maxSteps: 8,
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
