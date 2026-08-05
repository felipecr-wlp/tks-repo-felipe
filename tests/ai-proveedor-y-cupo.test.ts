/**
 * Tests de las DOS maneras de quedarse sin IA, que no son la misma y no se
 * arreglan igual.
 *
 * Contexto de por que existe esto. El free tier de Gemini da 20 peticiones AL
 * DIA. Con dos chats (KERN y BITACORA) y un equipo de doce personas, eso se
 * agota antes del mediodia: la IA del producto no fallaba de vez en cuando,
 * estaba apagada la mayor parte de la jornada. De ahi la palanca `IA_PROVEEDOR`
 * y de ahi que importe distinguir bien el motivo.
 *
 *   - CUOTA agotada: el cupo del periodo se acabo. Se repone solo al cambiar el
 *     dia. "Vuelve a intentarlo mañana" es un consejo correcto.
 *   - SALDO agotado: la cuenta no tiene dinero (DeepSeek contesta 402
 *     "Insufficient Balance"). Esto NO se repone solo. Decirle a alguien que
 *     espere a mañana lo manda a esperar en balde, y al dia siguiente sigue
 *     roto sin que nadie haya hecho lo unico que lo arregla, que es recargar.
 *
 * Es el mismo criterio que el resto del repo: un aviso que apunta al sitio
 * equivocado cuesta mas caro que no decir nada.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  esCuotaDeModeloAgotada,
  esSaldoAgotado,
  mensajeSinCupo,
  MENSAJE_CUOTA_AGOTADA,
  MENSAJE_SALDO_AGOTADO,
} from '@/lib/ai/client'

/** Error con status, como lo envuelve el SDK del proveedor. */
function errorConStatus(status: number, message: string) {
  return Object.assign(new Error(message), { statusCode: status })
}

describe('Distinguir cuota agotada de saldo agotado', () => {
  it('un 429 de Gemini es cuota, y se aconseja esperar', () => {
    const err = errorConStatus(429, 'RESOURCE_EXHAUSTED: quota exceeded')
    expect(esCuotaDeModeloAgotada(err)).toBe(true)
    expect(esSaldoAgotado(err)).toBe(false)
    expect(mensajeSinCupo(err)).toBe(MENSAJE_CUOTA_AGOTADA)
  })

  it('un 402 de DeepSeek es saldo, y NO se aconseja esperar a mañana', () => {
    const err = errorConStatus(402, 'Insufficient Balance')
    expect(esSaldoAgotado(err)).toBe(true)
    expect(mensajeSinCupo(err)).toBe(MENSAJE_SALDO_AGOTADO)
    expect(mensajeSinCupo(err)).not.toMatch(/mañana/i)
  })

  it('el saldo agotado tambien corta el paso como "sin cupo"', () => {
    // Si no entrara por aqui, caeria en el catch generico y saldria un 500 que
    // se lee como "la app esta rota".
    expect(esCuotaDeModeloAgotada(errorConStatus(402, 'Insufficient Balance'))).toBe(true)
  })

  it('reconoce el saldo agotado por el texto aunque no venga el status', () => {
    expect(esSaldoAgotado(new Error('Error: Insufficient Balance'))).toBe(true)
  })

  it('un fallo cualquiera NO se disfraza de falta de cupo', () => {
    const err = errorConStatus(500, 'internal error')
    expect(esCuotaDeModeloAgotada(err)).toBe(false)
    expect(esSaldoAgotado(err)).toBe(false)
  })
})

/**
 * Tripwire: ninguna ruta puede volver a responder el mensaje fijo de cuota.
 *
 * Es facil que alguien copie un handler viejo y vuelva a poner
 * `MENSAJE_CUOTA_AGOTADA` a pelo. Ese literal es correcto SOLO para la cuota;
 * puesto a ciegas, vuelve a mandar a esperar a quien se quedo sin saldo.
 */
describe('Las rutas eligen el mensaje segun el error, no uno fijo', () => {
  const API = join(process.cwd(), 'src', 'app', 'api')

  function rutas(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) rutas(full, out)
      else if (entry === 'route.ts') out.push(full)
    }
    return out
  }

  it('ninguna ruta devuelve el literal de cuota a pelo', () => {
    const culpables = rutas(API).filter(f =>
      /error:\s*MENSAJE_CUOTA_AGOTADA/.test(readFileSync(f, 'utf8'))
    )
    expect(culpables.map(f => f.replace(API, ''))).toEqual([])
  })

  it('las rutas que sirven IA pasan el error por mensajeSinCupo', () => {
    const conCuota = rutas(API).filter(f =>
      /esCuotaDeModeloAgotada/.test(readFileSync(f, 'utf8'))
    )
    // Si esto queda en cero, el scan dejo de mirar donde debia.
    expect(conCuota.length).toBeGreaterThanOrEqual(4)
    for (const f of conCuota) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/mensajeSinCupo\(/)
    }
  })
})

/**
 * Ninguna ruta comprueba a mano la key de Gemini.
 *
 * Antes de la palanca, cada ruta de IA validaba `GEMINI_API_KEY` por su cuenta.
 * Con dos proveedores posibles eso falla en las dos direcciones: si se activa
 * DeepSeek y se quita la key de Gemini, las cuatro rutas responden "falta
 * GEMINI_API_KEY" con DeepSeek perfectamente configurado; y si la key de Gemini
 * sigue puesta, la guarda pasa sin haber mirado la credencial que de verdad se
 * usa. Es el mismo pecado que el mensaje de cuota puesto a pelo: un aviso que
 * nombra el sitio equivocado.
 *
 * La comprobacion vive en `credencialIAFaltante()`, que mira el proveedor
 * activo. `client.ts` es el unico que puede leer la variable.
 */
describe('La credencial se comprueba por proveedor, no siempre Gemini', () => {
  const API = join(process.cwd(), 'src', 'app', 'api')

  function rutas(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) rutas(full, out)
      else if (entry === 'route.ts') out.push(full)
    }
    return out
  }

  it('ninguna ruta lee GEMINI_API_KEY directamente', () => {
    const culpables = rutas(API).filter(f =>
      /process\.env\.GEMINI_API_KEY/.test(readFileSync(f, 'utf8'))
    )
    expect(culpables.map(f => f.replace(API, ''))).toEqual([])
  })

  it('las rutas que sirven IA preguntan por la credencial del proveedor activo', () => {
    const conIA = rutas(API).filter(f => /credencialIAFaltante/.test(readFileSync(f, 'utf8')))
    // Si esto baja de cuatro, alguna ruta se quedo sin guarda.
    expect(conIA.length).toBeGreaterThanOrEqual(4)
  })
})

/**
 * Tripwire del adjunto: BITACORA acepta capturas y no todos los modelos las
 * leen. Si se quita esta guarda, con DeepSeek activo la persona veria un error
 * del proveedor y creeria que su captura estaba mal. Estaba bien; el modelo no
 * sabe verla.
 */
describe('El adjunto se corta cuando el modelo no lee imagenes', () => {
  const AGENTE = join(process.cwd(), 'src', 'app', 'api', 'daily-reports', 'agent', 'route.ts')

  it('el agente consulta MODELO_LEE_IMAGENES antes de mandar la imagen', () => {
    const src = readFileSync(AGENTE, 'utf8')
    expect(src).toMatch(/MODELO_LEE_IMAGENES/)
    expect(src).toMatch(/no puede leer imágenes/)
  })
})

/**
 * Cambiar de modelo cambia el ESTILO, no solo el precio.
 *
 * Los prompts prohibian el guion largo desde el principio porque asi se escribe
 * en esta casa. Nadie escribio "no uses emojis" porque con Gemini no hacia
 * falta: no los ponia. Probando DeepSeek de verdad, contesto con ✅ y ⚠️ en la
 * primera respuesta. La regla existia en la cabeza de las personas y en el
 * prompt del digest, pero no en el de los dos chats, y una regla que solo
 * aguanta porque el modelo de turno no la rompe no es una regla.
 *
 * Se comprueban los tres prompts juntos: el digest ya lo decia y no hay razon
 * para que los otros dos digan menos.
 */
describe('Los prompts prohiben emojis, no solo el guion largo', () => {
  const PROMPTS = [
    join('src', 'lib', 'ai', 'report-agent.ts'),
    join('src', 'lib', 'ai', 'client.ts'),
    join('src', 'lib', 'daily-report-digest.ts'),
  ]

  for (const rel of PROMPTS) {
    it(`${rel} le dice al modelo que no use emojis`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src).toMatch(/emojis/i)
      // Si se cayo la regla vieja, la nueva tampoco vale de mucho.
      expect(src).toMatch(/guiones largos/)
    })
  }
})

/**
 * El proveedor por defecto NO cambia. Sin tocar el entorno, esto sigue siendo
 * Gemini exactamente como antes. Un cambio de proveedor mueve a que empresa y a
 * que pais viajan los nombres y el trabajo de las personas del reporte diario:
 * es una decision de gobierno de informacion y tiene que ser explicita, nunca
 * un valor por omision que alguien se encuentre puesto.
 */
describe('El proveedor por defecto sigue siendo Gemini', () => {
  it('solo se va a DeepSeek si IA_PROVEEDOR lo pide', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'ai', 'client.ts'), 'utf8')
    expect(src).toMatch(/process\.env\.IA_PROVEEDOR \?\? 'gemini'/)
    expect(src).toMatch(/PROVEEDOR === 'deepseek'/)
  })
})
