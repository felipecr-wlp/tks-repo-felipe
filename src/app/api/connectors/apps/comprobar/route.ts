/**
 * POST /api/connectors/apps/comprobar
 *
 * Visita la URL de una herramienta candidata y dice si serviria, ANTES de
 * proponerla. No escribe nada: es puro diagnostico.
 *
 * El razonamiento de seguridad completo (por que solo https, por que se
 * resuelve el DNS a mano, por que no se siguen redirecciones y por que jamas
 * se devuelve el cuerpo) esta en `src/lib/connectors/comprobar-url.ts`. En una
 * frase: esto hace que el servidor visite una URL escrita por una persona, que
 * es la definicion de SSRF, asi que el permiso de salir a la red esta acotado
 * a proposito.
 *
 * Ser miembro del workspace es el piso. No pide admin: quien construye la
 * herramienta suele no serlo, y negarle la comprobacion seria obligarlo a
 * proponer a ciegas y esperar a que otro le diga que estaba mal.
 */
import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { z } from 'zod'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'
import { validarUrlPublica, esDireccionInterna, interpretar } from '@/lib/connectors/comprobar-url'

export const runtime = 'nodejs'

const esquema = z.object({
  workspace_id: z.string().uuid(),
  base_url: z.string().max(500),
  embed_path: z.string().max(200).optional(),
})

/** Corta sola: una herramienta que tarda mas que esto tampoco va a servir dentro. */
const TIEMPO_MAXIMO_MS = 6000

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = esquema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })
  }
  const { workspace_id, base_url, embed_path } = parsed.data

  const gate = await isWorkspaceAdminById(workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.role && !gate.isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const valid = validarUrlPublica(base_url)
  if (!valid.ok) {
    return NextResponse.json({
      ok: false, status: null, titulo: 'URL invalida', detalle: valid.motivo, enmarcable: false,
    })
  }

  // La ruta del embed se pega con la API de URL, no concatenando: un base_url
  // con su propia query lo convertiria en basura silenciosa.
  const destino = new URL(valid.url.toString())
  if (embed_path && embed_path.trim()) {
    const p = embed_path.trim()
    destino.pathname = p.startsWith('/') ? p : `/${p}`
  }

  // Se resuelve el nombre y se rechaza si CUALQUIERA de sus direcciones es
  // interna. Un nombre puede resolver a una publica y a una privada a la vez.
  try {
    const direcciones = await lookup(destino.hostname, { all: true })
    if (direcciones.length === 0 || direcciones.some((d) => esDireccionInterna(d.address))) {
      return NextResponse.json({
        ok: false, status: null,
        titulo: 'Ese dominio apunta a una red interna',
        detalle: 'WLO no visita direcciones privadas. Publica la herramienta en una URL alcanzable desde internet.',
        enmarcable: false,
      })
    }
  } catch {
    return NextResponse.json({
      ok: false, status: null,
      titulo: 'El dominio no existe',
      detalle: 'No se pudo resolver el nombre. Revisa que este bien escrito y ya desplegado.',
      enmarcable: false,
    })
  }

  const origenDeWlo = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://wlo.vercel.app'

  try {
    const res = await fetch(destino.toString(), {
      method: 'GET',
      redirect: 'manual', // seguir una redireccion es como se esquivaria el filtro de arriba
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      headers: { 'user-agent': 'WLO-marketplace-check' },
      cache: 'no-store',
    })

    // Del otro lado solo salen el codigo y dos cabeceras. El cuerpo se descarta
    // sin leerlo: devolverlo convertiria esto en un proxy de lectura.
    const veredicto = interpretar(
      res.status,
      {
        xFrameOptions: res.headers.get('x-frame-options'),
        csp: res.headers.get('content-security-policy'),
      },
      origenDeWlo,
    )
    return NextResponse.json(veredicto)
  } catch (err) {
    const abortada = err instanceof Error && err.name === 'TimeoutError'
    return NextResponse.json({
      ok: false, status: null,
      titulo: abortada ? 'Tardo demasiado' : 'No respondio',
      detalle: abortada
        ? `No contesto en ${TIEMPO_MAXIMO_MS / 1000} segundos. Dentro de WLO se veria igual de colgada.`
        : 'No se pudo conectar. Revisa que el deploy este vivo y la URL bien escrita.',
      enmarcable: false,
    })
  }
}
