/**
 * POST /api/daily-reports/agent
 * Chat en streaming de BITACORA, el agente del reporte diario.
 *
 * Es hermano de /api/kern y comparte su forma (mismo SDK, mismo modelo, misma
 * defensa contra inyeccion de roles), pero NO es el mismo endpoint: aqui el
 * agente esta amarrado a un workspace y a UN dia, y sus herramientas se arman
 * con esos dos datos ya resueltos en el servidor.
 *
 * Las tres decisiones que importan:
 *
 *  1. El dueño del reporte sale de la SESION. El cuerpo trae workspace_id y
 *     fecha, nunca un profile_id: no hay parametro por el que alguien pueda
 *     pedir que se escriba el dia de otra persona.
 *
 *  2. La imagen viaja en un campo PROPIO (`image`), no dentro de `messages`.
 *     Dejar que el cliente arme partes de contenido a mano es abrirle la puerta
 *     a mandar veinte imagenes o una de 8MB en un mensaje cualquiera del
 *     historial. Aqui es una, en el ultimo turno del usuario, con techo de
 *     tamaño, y el servidor es quien la adjunta.
 *
 *  3. La imagen NO se guarda aqui. Se manda al modelo en linea para que redacte
 *     la actividad y su pie de foto, y se descarta. Guardarla es un paso aparte
 *     y explicito (POST .../entries/[entryId]/images) que ocurre despues, ya
 *     comprimida por el navegador y colgada de la actividad que el agente creo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { streamText, type CoreMessage } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { geminiFlash } from '@/lib/ai/client'
import { applyRateLimit } from '@/lib/rate-limit'
import { isReportSupervisor } from '@/lib/daily-report-access'
import {
  REPORT_AGENT_SYSTEM,
  buildReportAgentTools,
  buildPreviousDayBlock,
  resolveAgentDate,
} from '@/lib/ai/report-agent'

export const maxDuration = 30

/**
 * Techo del adjunto en base64. El navegador manda la version ya comprimida
 * (~900KB como maximo, ver daily-report-images.ts), y base64 infla un tercio:
 * 1.6M de caracteres deja margen de sobra y aun asi cabe bajo el limite de
 * cuerpo que Vercel impone a una serverless function.
 */
const MAX_IMAGE_CHARS = 1_600_000

const bodySchema = z
  .object({
    // Igual que en KERN: el rol se restringe a user/assistant para que el
    // cliente no pueda colar un 'system' y reescribir el procedimiento.
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(8000),
        })
      )
      .min(1)
      .max(40),
    workspace_id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    image: z
      .object({
        /** data URL completa: `data:image/webp;base64,...` */
        data: z.string().max(MAX_IMAGE_CHARS),
        mime: z.enum(['image/webp', 'image/jpeg']),
      })
      .nullable()
      .optional(),
  })
  .strict()

/** Extrae el base64 de una data URL y verifica que el tipo declarado coincida. */
function decodeDataUrl(data: string, mime: string): string | null {
  const match = /^data:(image\/webp|image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data)
  if (!match) return null
  if (match[1] !== mime) return null
  return match[2]
}

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
      { error: 'El asistente de reportes no está configurado: falta GEMINI_API_KEY en el servidor.' },
      { status: 503 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const { messages: raw, workspace_id, date, image } = parsed.data

  const totalChars = raw.reduce((sum, m) => sum + m.content.length, 0)
  if (totalChars > 24000) {
    return NextResponse.json({ error: 'La conversación es demasiado larga' }, { status: 413 })
  }

  const admin = createAdminClient()

  // Pertenencia al workspace: se re-verifica siempre (anti-IDOR sobre workspace_id).
  const { data: member } = (await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle()) as { data: { workspace_id: string } | null }

  if (!member) {
    return NextResponse.json({ error: 'Sin acceso a ese espacio de trabajo' }, { status: 403 })
  }

  const day = resolveAgentDate(date)

  // El rol y la memoria del dia anterior son independientes entre si, y el
  // segundo son dos consultas: en serie se notarian antes del primer token.
  const [isSupervisor, previousDay] = await Promise.all([
    isReportSupervisor(admin, workspace_id, user.id),
    buildPreviousDayBlock(admin, { workspaceId: workspace_id, userId: user.id, date: day }),
  ])

  // ── Mensajes ────────────────────────────────────────────────────────────────
  const messages: CoreMessage[] = raw.map(m => ({ role: m.role, content: m.content }) as CoreMessage)

  // La imagen se pega al ULTIMO turno del usuario, que es el que la traia. Si el
  // ultimo mensaje no es del usuario, el adjunto se ignora: no hay a que
  // pertenezca y colgarlo de otro turno seria inventar contexto.
  if (image) {
    const b64 = decodeDataUrl(image.data, image.mime)
    if (!b64) {
      return NextResponse.json({ error: 'La imagen adjunta no es válida' }, { status: 422 })
    }

    const last = messages[messages.length - 1]
    if (last?.role === 'user') {
      last.content = [
        { type: 'text', text: typeof last.content === 'string' ? last.content : '' },
        { type: 'image', image: b64, mimeType: image.mime },
      ]
    }
  }

  // ── Fecha en el prompt ──────────────────────────────────────────────────────
  // El modelo necesita saber sobre que dia conversa, porque la pantalla permite
  // moverse a dias anteriores y "hoy" dejaria de ser cierto.
  const scopeBlock = `\n\nContexto de esta sesión: estás registrando el reporte del día ${day}.${
    isSupervisor ? ' La persona con la que hablas es responsable de equipo.' : ''
  }`

  try {
    const result = await streamText({
      model: geminiFlash,
      system: REPORT_AGENT_SYSTEM + scopeBlock + previousDay,
      messages,
      temperature: 0.4,
      tools: buildReportAgentTools({
        admin,
        userId: user.id,
        workspaceId: workspace_id,
        date: day,
        isSupervisor,
      }),
      // Suficiente para registrar varias actividades de un mismo mensaje y
      // redactar la respuesta, o para leer el dia antes de cerrarlo.
      maxSteps: 8,
    })

    return result.toDataStreamResponse()
  } catch (err) {
    console.error('[daily-reports agent] stream error:', err)
    return NextResponse.json({ error: 'Error al generar la respuesta.' }, { status: 500 })
  }
}
