/**
 * Contrato anti stored-XSS de sanitizeRichText. Fija que el saneado que protege
 * las dos vistas que pintan HTML crudo (impresion de notas + descripcion de
 * tarea) quita scripts, manejadores on*, URIs peligrosas e iframes, y conserva
 * el texto enriquecido legitimo del editor Tiptap.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeRichText } from '@/lib/sanitize'

describe('sanitizeRichText', () => {
  it('elimina etiquetas <script>', () => {
    const out = sanitizeRichText('<p>hola</p><script>alert(1)</script>')
    expect(out).toContain('<p>hola</p>')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('elimina manejadores on* (onerror en img)', () => {
    const out = sanitizeRichText('<img src=x onerror="alert(document.cookie)">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out.toLowerCase()).not.toContain('alert')
  })

  it('neutraliza enlaces javascript:', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">click</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('elimina <iframe>', () => {
    const out = sanitizeRichText('<iframe src="https://evil.com"></iframe>')
    expect(out.toLowerCase()).not.toContain('<iframe')
  })

  it('elimina atributo style (vector de exfil/UI redress)', () => {
    const out = sanitizeRichText('<p style="position:absolute">x</p>')
    expect(out.toLowerCase()).not.toContain('style=')
  })

  it('conserva texto enriquecido legitimo', () => {
    const html = '<h2>Titulo</h2><p><strong>negrita</strong> y <em>cursiva</em></p><ul><li>uno</li></ul>'
    const out = sanitizeRichText(html)
    expect(out).toContain('<h2>Titulo</h2>')
    expect(out).toContain('<strong>negrita</strong>')
    expect(out).toContain('<li>uno</li>')
  })

  it('conserva enlaces http y les agrega rel de seguridad', () => {
    const out = sanitizeRichText('<a href="https://ejemplo.com">link</a>')
    expect(out).toContain('href="https://ejemplo.com"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
  })

  it('devuelve string vacio para null, undefined o vacio', () => {
    expect(sanitizeRichText(null)).toBe('')
    expect(sanitizeRichText(undefined)).toBe('')
    expect(sanitizeRichText('')).toBe('')
  })
})
