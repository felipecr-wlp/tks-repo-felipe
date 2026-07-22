/**
 * GET /api/teams/[teamId]/chat-files/sign?paths=<a>,<b>,…
 * Resuelve signed URLs temporales para archivos del chat de un equipo. Los paths
 * viven en la columna attachments jsonb del mensaje; como las signed URL caducan,
 * el cliente las pide en vivo al render y las re-firma cuando expiran.
 *
 * Seguridad:
 *  - Auth + canAccessTeamById.
 *  - Cada path DEBE empezar con team/<teamId>/ (anti-IDOR: no se firma nada de
 *    otro equipo aunque el path venga manipulado).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessTeamById } from '@/lib/team-access'
import { CHAT_FILES_BUCKET as BUCKET } from '@/lib/chat-files'

const SIGNED_TTL = 60 * 60 // 1 hora
const MAX_PATHS = 40

export async function GET(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  if (!isUuid(params.teamId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const raw = (url.searchParams.get('paths') ?? '').trim()
  if (!raw) return NextResponse.json({ files: [] })

  const prefix = `team/${params.teamId}/`
  const paths = Array.from(new Set(raw.split(',').map(p => p.trim()).filter(Boolean)))
    .filter(p => p.startsWith(prefix) && !p.includes('..'))
    .slice(0, MAX_PATHS)

  if (paths.length === 0) return NextResponse.json({ files: [] })

  const admin = createAdminClient()
  if (!(await canAccessTeamById(admin, params.teamId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  const files: { path: string; url: string }[] = []
  await Promise.all(
    paths.map(async path => {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL)
      if (signed?.signedUrl) files.push({ path, url: signed.signedUrl })
    })
  )

  return NextResponse.json({ files })
}
