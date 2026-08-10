/**
 * Tripwire de las rutas de la galeria de videos (escaneo de fuente).
 *
 * Lo que se afirma, y por que importa:
 *   1. TODA ruta tiene rate limit y autenticacion. La ruta que se olvide de
 *      auth sirve URLs firmadas de video interno a internet.
 *   2. Las rutas de ESCRITURA del catalogo (upload-url, crear, editar, borrar)
 *      exigen isOrgAdmin. Sin eso, cualquier miembro publica o borra videos.
 *   3. stream y progress NO exigen admin: son las rutas del usuario comun.
 *      Este lado tambien se afirma porque el fallo inverso (endurecer de mas)
 *      es invisible: la galeria "funciona" para quien la programo, que es
 *      admin, y nadie mas puede reproducir nada. Exactamente la clase de rojo
 *      que no truena en dev.
 *   4. Las rutas con [videoId] validan el parametro con isUuid.
 *
 * Alcance honesto: verifica presencia de llamadas, no su orden ni su logica.
 * Es la red contra la regresion barata (borrar una linea), no una prueba de
 * autorizacion end-to-end.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = join(process.cwd(), 'src', 'app', 'api', 'academy', 'videos')

const RUTAS = {
  lista: join(BASE, 'route.ts'),
  uploadUrl: join(BASE, 'upload-url', 'route.ts'),
  porId: join(BASE, '[videoId]', 'route.ts'),
  stream: join(BASE, '[videoId]', 'stream', 'route.ts'),
  progress: join(BASE, '[videoId]', 'progress', 'route.ts'),
} as const

const src = Object.fromEntries(
  Object.entries(RUTAS).map(([k, p]) => [k, readFileSync(p, 'utf8')]),
) as Record<keyof typeof RUTAS, string>

describe('Invariantes de las rutas de la galeria de videos', () => {
  it('todas las rutas aplican rate limit y autenticacion', () => {
    for (const [nombre, codigo] of Object.entries(src)) {
      expect(`${nombre} tiene rate limit: ${codigo.includes('applyRateLimit')}`).toBe(
        `${nombre} tiene rate limit: true`,
      )
      expect(`${nombre} autentica: ${codigo.includes('auth.getUser()')}`).toBe(
        `${nombre} autentica: true`,
      )
    }
  })

  it('la escritura del catalogo exige admin de la org', () => {
    for (const nombre of ['uploadUrl', 'porId'] as const) {
      expect(`${nombre} exige admin: ${src[nombre].includes('isOrgAdmin')}`).toBe(
        `${nombre} exige admin: true`,
      )
    }
    // route.ts mezcla GET (miembro) y POST (admin): el POST debe tener la
    // barrera con su 403, no solo mencionar la funcion.
    expect(src.lista).toContain('Solo administradores')
  })

  it('stream y progress NO exigen admin para el camino feliz', () => {
    // isOrgAdmin puede aparecer para PERMITIR borradores al admin, pero jamas
    // como barrera 403 de "Solo administradores": eso dejaria al equipo sin
    // reproducir nada, en silencio.
    for (const nombre of ['stream', 'progress'] as const) {
      expect(`${nombre} bloquea a no-admins: ${src[nombre].includes('Solo administradores')}`).toBe(
        `${nombre} bloquea a no-admins: false`,
      )
    }
  })

  it('las rutas con [videoId] validan el parametro', () => {
    for (const nombre of ['porId', 'stream', 'progress'] as const) {
      expect(`${nombre} valida uuid: ${src[nombre].includes('isUuid(params.videoId)')}`).toBe(
        `${nombre} valida uuid: true`,
      )
    }
  })

  it('el binario nunca pasa por la funcion: la subida es por URL firmada', () => {
    expect(src.uploadUrl).toContain('createSignedUploadUrl')
    // Y el registro verifica que el objeto exista antes de insertar la fila.
    expect(src.lista).toContain('existeEnStorage')
  })
})
