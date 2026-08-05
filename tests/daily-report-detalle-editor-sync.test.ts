/**
 * Tripwire del ACOPLE INVISIBLE entre RichTextEditor y el panel de detalle del
 * reporte diario.
 *
 * El contrato, que no esta escrito en ningun tipo y por eso se rompe callado:
 * `RichTextEditor` NO es un componente controlado. Solo copia el `value` que le
 * llega de fuera cuando su contenido esta VACIO (`<p></p>`). Esa guarda es
 * correcta y no se debe aflojar: existe para que un render del padre no pise lo
 * que la persona esta tecleando.
 *
 * La consecuencia es la que muerde. Si alguien inyecta texto en un editor YA
 * MONTADO y NO VACIO, el texto entra al estado de React y NO se ve. La pantalla
 * y el dato se separan sin un solo error: no hay excepcion, no hay toast rojo,
 * no hay 500. Medido en produccion antes del arreglo: el segundo "Desglosar con
 * IA" sobre un detalle ya escrito dejaba CINCO puntos en pantalla y guardaba
 * NUEVE en la base. La persona guardaba texto que nunca leyo.
 *
 * Hoy el unico sitio que inyecta sobre un editor montado es el desglose de la
 * IA en EntradaDetalle. Los otros tres usos de RichTextEditor (resumen del dia,
 * detalle de tarea, nota) DESMONTAN el editor al cancelar o no reinyectan nunca,
 * asi que no dependen de esto. El arreglo, por tanto, vive en el call site
 * (`key` que remonta) y no en el editor compartido: cambiarle las reglas al
 * editor arreglaria esta pantalla y arriesgaria las otras tres.
 *
 * Este archivo sujeta las dos mitades del acople, que viven en archivos
 * distintos y por separado parecen inofensivas:
 *   A) El editor sigue adoptando `value` externo SOLO si esta vacio. Si alguien
 *      cambia esa regla, el `key` de abajo pasa a ser innecesario o insuficiente
 *      y hay que revisarlo a mano.
 *   B) El panel de detalle sigue remontando el editor cuando llega el borrador
 *      de la IA. Un `key` sin explicacion es justo lo que alguien borra al
 *      "limpiar"; si lo borra, esto se pone rojo y no la produccion.
 *
 * Determinista: solo lee fuentes. Ni DOM ni red ni base.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDITOR = join(process.cwd(), 'src', 'components', 'editor', 'RichTextEditor.tsx')
const PANEL = join(
  process.cwd(),
  'src',
  'app',
  '(app)',
  'w',
  '[workspaceSlug]',
  'reportes',
  'EntradaDetalle.tsx'
)

const editorSrc = readFileSync(EDITOR, 'utf8')
const panelSrc = readFileSync(PANEL, 'utf8')

/** El bloque JSX `<RichTextEditor ... />` del panel de detalle. */
function bloqueDelEditor(src: string): string {
  const i = src.indexOf('<RichTextEditor')
  expect(i, 'EntradaDetalle debe seguir montando RichTextEditor').toBeGreaterThan(-1)
  const fin = src.indexOf('/>', i)
  expect(fin, 'el JSX de RichTextEditor debe cerrarse').toBeGreaterThan(i)
  return src.slice(i, fin)
}

describe('Acople RichTextEditor <-> detalle del reporte diario', () => {
  it('A) el editor solo adopta `value` externo cuando esta vacio', () => {
    // Si esto se pone rojo, el editor cambio de semantica. No es "arreglar el
    // test": hay que ir a los call sites y decidir si el remonte sigue haciendo
    // falta.
    expect(editorSrc).toMatch(/current === '<p><\/p>'/)
    expect(editorSrc).toMatch(/editor\.commands\.setContent\(value/)
  })

  it('B) el panel remonta el editor con `key` para que el borrador de la IA se vea', () => {
    expect(bloqueDelEditor(panelSrc)).toMatch(/key=\{revision\}/)
  })

  it('B) el desglose de la IA sube la revision, o el borrador entraria invisible', () => {
    const i = panelSrc.indexOf('async function desglosar')
    expect(i, 'debe existir la funcion desglosar').toBeGreaterThan(-1)
    const cuerpo = panelSrc.slice(i, panelSrc.indexOf('\n  }', i))
    expect(cuerpo).toMatch(/setRevision\(/)
  })

  it('la revision NO sube al teclear: solo la mueve el desglose', () => {
    // Un `setRevision` en el onSave del editor lo remontaria en cada pulsacion y
    // se perderia el cursor. Debe haber exactamente una subida, la de la IA.
    const subidas = panelSrc.match(/setRevision\(/g) ?? []
    expect(subidas.length).toBe(1)
  })
})
