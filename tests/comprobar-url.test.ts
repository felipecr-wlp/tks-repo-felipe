/**
 * Pruebas de la comprobacion de URL del marketplace.
 *
 * Se prueban las dos mitades por separado porque fallan distinto:
 *
 *   - `esDireccionInterna` y `validarUrlPublica` son la GUARDA. Si se aflojan,
 *     el servidor de WLO se vuelve un oraculo para tocar la red interna desde
 *     un formulario. Un falso negativo aqui es un agujero, no una molestia, asi
 *     que se prueban los bordes exactos de cada rango (172.15 fuera, 172.16
 *     dentro, 172.31 dentro, 172.32 fuera) y no un caso feliz por familia.
 *   - `interpretar` es el MENSAJE. Si se equivoca, alguien pierde una tarde
 *     mirando un recuadro en blanco, que es justo lo que esto vino a evitar.
 *
 * Sin red y sin DNS: `interpretar` recibe el estado y las cabeceras ya leidas.
 */
import { describe, it, expect } from 'vitest'
import {
  validarUrlPublica,
  esDireccionInterna,
  interpretar,
} from '@/lib/connectors/comprobar-url'

const WLO = 'https://wlo.vercel.app'

describe('validarUrlPublica', () => {
  it('acepta una https con dominio publico', () => {
    const r = validarUrlPublica('https://mi-herramienta.vercel.app')
    expect(r.ok).toBe(true)
  })

  it('rechaza http, aunque el dominio sea publico', () => {
    // Sin esto, la comprobacion sirve para hablar en claro con cualquier cosa.
    const r = validarUrlPublica('http://ejemplo.com')
    expect(r.ok).toBe(false)
  })

  it('rechaza localhost y cualquier host sin punto', () => {
    // El caso que mas se pide como "excepcion para desarrollo" y que aqui seria
    // exactamente el agujero.
    for (const raw of ['https://localhost', 'https://localhost:3000', 'https://metadata']) {
      expect(validarUrlPublica(raw).ok, raw).toBe(false)
    }
  })

  it('rechaza credenciales embebidas en la URL', () => {
    // https://usuario:clave@host es una forma clasica de confundir a un parser
    // y de filtrar secretos a los logs.
    expect(validarUrlPublica('https://user:pass@ejemplo.com').ok).toBe(false)
  })

  it('rechaza lo que no es una URL', () => {
    expect(validarUrlPublica('no soy una url').ok).toBe(false)
    expect(validarUrlPublica('').ok).toBe(false)
  })
})

describe('esDireccionInterna: rangos que NO son internet', () => {
  it('marca como interna cada familia privada o reservada', () => {
    const internas = [
      '10.0.0.1', '10.255.255.255',      // privada
      '127.0.0.1',                        // bucle local
      '0.0.0.0',                          // este host
      '169.254.169.254',                  // metadatos de la nube, el clasico
      '172.16.0.1', '172.31.255.255',     // privada
      '192.168.1.1',                      // privada
      '100.64.0.1',                       // CGNAT
      '224.0.0.1', '255.255.255.255',     // multicast y reservadas
      '::1', '::',                        // bucle local IPv6
      'fc00::1', 'fd12:3456::1',          // unicas locales
      'fe80::1',                          // enlace local
    ]
    for (const ip of internas) {
      expect(esDireccionInterna(ip), `${ip} deberia ser interna`).toBe(true)
    }
  })

  it('deja pasar direcciones publicas de verdad', () => {
    const publicas = ['8.8.8.8', '1.1.1.1', '76.76.21.21', '2606:4700::1111']
    for (const ip of publicas) {
      expect(esDireccionInterna(ip), `${ip} deberia ser publica`).toBe(false)
    }
  })

  it('respeta los bordes exactos de 172.16.0.0/12', () => {
    // El rango que mas se implementa mal: no es "todo 172".
    expect(esDireccionInterna('172.15.255.255')).toBe(false)
    expect(esDireccionInterna('172.16.0.0')).toBe(true)
    expect(esDireccionInterna('172.31.255.255')).toBe(true)
    expect(esDireccionInterna('172.32.0.0')).toBe(false)
  })

  it('respeta los bordes de 100.64.0.0/10 y del multicast', () => {
    expect(esDireccionInterna('100.63.255.255')).toBe(false)
    expect(esDireccionInterna('100.64.0.0')).toBe(true)
    expect(esDireccionInterna('100.127.255.255')).toBe(true)
    expect(esDireccionInterna('100.128.0.0')).toBe(false)
    expect(esDireccionInterna('223.255.255.255')).toBe(false)
    expect(esDireccionInterna('224.0.0.0')).toBe(true)
  })

  it('no se deja enganar por IPv4 mapeada en IPv6', () => {
    // ::ffff:127.0.0.1 es 127.0.0.1 escrito de otra forma. Si el prefijo no se
    // quita, el bucle local pasa como publico.
    expect(esDireccionInterna('::ffff:127.0.0.1')).toBe(true)
    expect(esDireccionInterna('::ffff:169.254.169.254')).toBe(true)
    expect(esDireccionInterna('::ffff:8.8.8.8')).toBe(false)
  })
})

describe('interpretar: traduce la respuesta a algo accionable', () => {
  const sinCabeceras = { xFrameOptions: null, csp: null }

  it('un 3xx se explica como la proteccion del hosting, no como "error"', () => {
    // Es el caso que mas confunde: dentro del marco no se ve como fallo, se ve
    // como si tu herramienta fuera el login de otro.
    const v = interpretar(302, sinCabeceras, WLO)
    expect(v.ok).toBe(false)
    expect(v.enmarcable).toBe(false)
    expect(v.detalle.toLowerCase()).toContain('acceso')
  })

  it('401 y 403 dicen que WLO la abre sin sesion', () => {
    for (const s of [401, 403]) {
      const v = interpretar(s, sinCabeceras, WLO)
      expect(v.ok, `${s}`).toBe(false)
      expect(v.status).toBe(s)
    }
  })

  it('404 apunta a la ruta del embed, no al dominio', () => {
    const v = interpretar(404, sinCabeceras, WLO)
    expect(v.ok).toBe(false)
    expect(v.detalle.toLowerCase()).toContain('ruta')
  })

  it('5xx culpa al deploy de la herramienta', () => {
    const v = interpretar(500, sinCabeceras, WLO)
    expect(v.ok).toBe(false)
  })

  it('200 sin cabeceras que estorben es el caso bueno', () => {
    const v = interpretar(200, sinCabeceras, WLO)
    expect(v.ok).toBe(true)
    expect(v.enmarcable).toBe(true)
  })

  it('X-Frame-Options DENY y SAMEORIGIN se distinguen entre si', () => {
    // Son dos problemas distintos con dos arreglos distintos, y decir "no se
    // deja enmarcar" a secas manda a la persona a adivinar cual.
    const deny = interpretar(200, { xFrameOptions: 'DENY', csp: null }, WLO)
    expect(deny.ok).toBe(false)
    expect(deny.enmarcable).toBe(false)

    const same = interpretar(200, { xFrameOptions: 'SAMEORIGIN', csp: null }, WLO)
    expect(same.ok).toBe(false)
    expect(same.titulo).not.toBe(deny.titulo)
    // Le dice con que reemplazarlo, no solo que esta mal.
    expect(same.detalle).toContain(WLO)
  })

  it('no se deja enganar por mayusculas en las cabeceras', () => {
    // Los nombres y valores de cabecera no son sensibles a mayusculas.
    expect(interpretar(200, { xFrameOptions: 'deny', csp: null }, WLO).ok).toBe(false)
    expect(interpretar(200, { xFrameOptions: 'SameOrigin', csp: null }, WLO).ok).toBe(false)
  })

  it('un frame-ancestors que nombra a WLO pasa', () => {
    const v = interpretar(
      200,
      { xFrameOptions: null, csp: `frame-ancestors ${WLO}; default-src 'self'` },
      WLO,
    )
    expect(v.ok).toBe(true)
    expect(v.enmarcable).toBe(true)
  })

  it('un frame-ancestors que NO nombra a WLO se rechaza aunque responda 200', () => {
    // El fallo silencioso mas caro: la herramienta esta viva y aun asi sale en
    // blanco, porque su propia politica deja fuera a WLO.
    const v = interpretar(
      200,
      { xFrameOptions: null, csp: 'frame-ancestors https://otro-sitio.com' },
      WLO,
    )
    expect(v.ok).toBe(false)
    expect(v.enmarcable).toBe(false)
    expect(v.detalle).toContain(WLO)
  })

  it('un frame-ancestors con comodin pasa', () => {
    const v = interpretar(200, { xFrameOptions: null, csp: 'frame-ancestors *' }, WLO)
    expect(v.ok).toBe(true)
  })

  it('solo mira su propia directiva, no otras que mencionen dominios', () => {
    // Si se buscara el dominio en todo el CSP, un default-src que nombre a WLO
    // daria un falso verde con un frame-ancestors que lo excluye.
    const v = interpretar(
      200,
      {
        xFrameOptions: null,
        csp: `default-src ${WLO}; frame-ancestors https://otro-sitio.com; script-src 'self'`,
      },
      WLO,
    )
    expect(v.ok).toBe(false)
  })
})
