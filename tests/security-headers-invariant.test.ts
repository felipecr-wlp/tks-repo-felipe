/**
 * Tripwire de CABECERAS DE SEGURIDAD (clickjacking, MIME sniffing, fuga de Referer,
 * downgrade a HTTP, XSS por falta de CSP).
 *
 * Las cabeceras de seguridad son la defensa del NAVEGADOR: no dependen del handler,
 * se aplican a toda respuesta. Si alguien las debilita en un refactor de
 * next.config, se abren clases enteras de ataque de golpe y en silencio:
 *   - sin X-Frame-Options / frame-ancestors -> la app se puede EMBEBER en un iframe
 *     ajeno para clickjacking;
 *   - sin X-Content-Type-Options: nosniff -> el navegador adivina el MIME y puede
 *     ejecutar como script un upload disfrazado;
 *   - sin Referrer-Policy -> se filtra la URL completa (con ids) a sitios externos;
 *   - sin HSTS -> downgrade a HTTP y MITM;
 *   - una CSP laxa (frame-ancestors con comodin, sin object-src 'none', sin
 *     base-uri 'self') deja pasar reframing e inyeccion de <base>/<object>.
 *
 * Contrato: next.config.mjs aplica las cabeceras a TODAS las rutas (`/(.*)`),
 * declara cada cabecera critica con su valor endurecido, y la CSP conserva sus
 * directivas de bloqueo (default-src 'self', frame-ancestors 'self', base-uri
 * 'self', object-src 'none') SIN comodin en frame-ancestors. Debilitar cualquiera
 * cae aqui.
 *
 * Determinista: solo lee la fuente de config, no monta el server.
 *
 * Hoy las 6 cabeceras estan y la CSP esta endurecida. Una regresion que las afloje
 * rompe el test. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8')

describe('Invariante: las cabeceras de seguridad se aplican a toda ruta y siguen endurecidas', () => {
  it('las cabeceras se aplican a todas las rutas via headers() con source /(.*)', () => {
    expect(CONFIG).toMatch(/async headers\(\)/)
    expect(CONFIG).toMatch(/source:\s*'\/\(\.\*\)'/)
  })

  it('declara X-Frame-Options: SAMEORIGIN (anti clickjacking)', () => {
    expect(CONFIG).toMatch(/'X-Frame-Options',\s*value:\s*'SAMEORIGIN'/)
  })

  it('declara X-Content-Type-Options: nosniff (anti MIME sniffing)', () => {
    expect(CONFIG).toMatch(/'X-Content-Type-Options',\s*value:\s*'nosniff'/)
  })

  it('declara Referrer-Policy: strict-origin-when-cross-origin', () => {
    expect(CONFIG).toMatch(/'Referrer-Policy',\s*value:\s*'strict-origin-when-cross-origin'/)
  })

  it('declara HSTS con includeSubDomains (anti downgrade/MITM)', () => {
    expect(CONFIG).toMatch(/'Strict-Transport-Security',\s*value:\s*'max-age=\d+;\s*includeSubDomains/)
  })

  it('declara una Content-Security-Policy', () => {
    expect(CONFIG).toMatch(/'Content-Security-Policy'/)
  })

  it('la CSP conserva sus directivas de bloqueo endurecidas', () => {
    expect(CONFIG).toMatch(/default-src 'self'/)
    expect(CONFIG).toMatch(/frame-ancestors 'self'/)
    expect(CONFIG).toMatch(/base-uri 'self'/)
    expect(CONFIG).toMatch(/object-src 'none'/)
  })

  /**
   * Permissions-Policy tiene DOS formas de estar mal y ninguna avisa.
   *
   * Estuvo en `camera=()`, lista vacia, que parecia lo mas seguro y rompio algo
   * que nadie habia pensado: grabar un Loom de la app. El grabador pide la
   * camara desde un content script, que corre en el marco de nuestra pagina, y
   * se comia nuestra politica. Se apagaba solo la cara mientras la pantalla
   * seguia grabando, sin ningun aviso, porque quien bloquea es el navegador.
   *
   * Y abrirlo a `*` es el error contrario: los iframes del marketplace tambien
   * podrian pedir camara, y el navegador enseña el permiso a nombre de WLO.
   *
   * El punto medio es `(self)`, y por eso se fija aqui en las dos direcciones.
   */
  it('camera y microphone estan acotados a (self): ni cerrados a nadie ni abiertos a todos', () => {
    expect(CONFIG).toMatch(/camera=\(self\)/)
    expect(CONFIG).toMatch(/microphone=\(self\)/)
    expect(/camera=\*/.test(CONFIG)).toBe(false)
    expect(/microphone=\*/.test(CONFIG)).toBe(false)
    expect(/camera=\(\)/.test(CONFIG)).toBe(false)
  })

  it('geolocation sigue cerrado: nada en la app la usa', () => {
    expect(CONFIG).toMatch(/geolocation=\(\)/)
  })

  it('la CSP NUNCA permite frame-ancestors con comodin (reframing arbitrario)', () => {
    // Ni un "*" ni un esquema abierto en frame-ancestors: solo 'self' (u hosts fijos).
    expect(/frame-ancestors[^;]*\*/.test(CONFIG)).toBe(false)
    expect(/frame-ancestors[^;]*https?:(?![/])/.test(CONFIG)).toBe(false)
  })
})
