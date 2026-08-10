/**
 * Reuso de la URL firmada de reproduccion.
 *
 * LO QUE ESTO PROTEGE, y por que se escribio. Antes se firmaba en cada carga:
 * el token lleva su instante de emision, asi que dos visitas daban dos cadenas
 * distintas y el navegador descargaba el video ENTERO otra vez. Medido en
 * produccion. Con un video de 200MB y 60 personas que lo abren tres veces, eso
 * son 36GB por el mismo contenido.
 *
 * Los dos fallos posibles son opuestos y los dos importan:
 *   - No reusar cuando se puede: vuelve el problema, sin sintoma visible.
 *   - Reusar una URL a punto de caducar: alguien empieza a ver y el video se
 *     corta a los dos minutos, con cara de fallo de red.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  urlDeReproduccion, TTL_URL_FIRMADA, MARGEN_RENOVACION,
} from '@/lib/academy/url-firmada'

/** Admin falso: cuenta cuantas veces se firma y deja inspeccionar el update. */
function adminFalso(urlNueva = 'https://nueva/firmada') {
  const firmas: string[] = []
  const updates: unknown[] = []
  const admin = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          firmas.push(path)
          return { data: { signedUrl: urlNueva }, error: null }
        },
      }),
    },
    from: () => ({
      update: (v: unknown) => {
        updates.push(v)
        // El codigo hace `.eq(...).then(...)`: se imita la cadena minima.
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  }
  return { admin, firmas, updates }
}

const enHoras = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

describe('Reuso de la URL firmada', () => {
  it('REUSA la guardada cuando le queda tiempo de sobra', async () => {
    const { admin, firmas } = adminFalso()
    const url = await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/a.mp4',
      signed_url: 'https://vieja/pero/vigente',
      signed_url_expires_at: enHoras(20),
    })
    expect(url).toBe('https://vieja/pero/vigente')
    // Lo que de verdad importa: NO se volvio a firmar.
    expect(firmas).toHaveLength(0)
  })

  it('firma de nuevo si NUNCA se habia guardado', async () => {
    const { admin, firmas } = adminFalso()
    const url = await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/a.mp4', signed_url: null, signed_url_expires_at: null,
    })
    expect(url).toBe('https://nueva/firmada')
    expect(firmas).toEqual(['videos/a.mp4'])
  })

  it('RENUEVA antes de que caduque, no en el ultimo momento', async () => {
    // Dentro del margen: si se reusara, alguien podria empezar a ver y que el
    // video se le corte a media reproduccion.
    const { admin, firmas } = adminFalso()
    const url = await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/a.mp4',
      signed_url: 'https://casi/caduca',
      signed_url_expires_at: enHoras(MARGEN_RENOVACION / 3600 - 0.5),
    })
    expect(url).toBe('https://nueva/firmada')
    expect(firmas).toHaveLength(1)
  })

  it('una URL ya caducada no se reusa', async () => {
    const { admin, firmas } = adminFalso()
    const url = await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/a.mp4',
      signed_url: 'https://caducada',
      signed_url_expires_at: enHoras(-1),
    })
    expect(url).toBe('https://nueva/firmada')
    expect(firmas).toHaveLength(1)
  })

  it('guarda la nueva URL con su fecha de caducidad', async () => {
    const { admin, updates } = adminFalso()
    await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/a.mp4', signed_url: null, signed_url_expires_at: null,
    })
    const u = updates[0] as { signed_url: string; signed_url_expires_at: string }
    expect(u.signed_url).toBe('https://nueva/firmada')
    const faltan = (new Date(u.signed_url_expires_at).getTime() - Date.now()) / 1000
    // Cerca del TTL, con holgura por el tiempo de ejecucion del test.
    expect(faltan).toBeGreaterThan(TTL_URL_FIRMADA - 60)
    expect(faltan).toBeLessThanOrEqual(TTL_URL_FIRMADA + 1)
  })

  it('si el objeto no existe devuelve null en vez de una URL rota', async () => {
    const admin = {
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'no existe' } }) }) },
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }
    const url = await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/fantasma.mp4', signed_url: null, signed_url_expires_at: null,
    })
    expect(url).toBeNull()
  })

  it('si NO se puede guardar el cache, igual devuelve la URL', async () => {
    // Perder el cache es caro; no dejar ver el video es peor. El guardado es
    // best-effort a proposito.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const admin = {
      storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://ok' }, error: null }) }) },
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: { message: 'sin permiso' } }) }) }),
    }
    const url = await urlDeReproduccion(admin as never, 'v1', {
      storage_path: 'videos/a.mp4', signed_url: null, signed_url_expires_at: null,
    })
    expect(url).toBe('https://ok')
    err.mockRestore()
  })
})
