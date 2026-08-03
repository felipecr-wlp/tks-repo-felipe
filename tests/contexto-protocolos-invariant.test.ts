/**
 * Tripwire del CONTEXTO que lee la IA (`CLAUDE.md`).
 *
 * Todo el repo esta cubierto por tripwires. El archivo que le dice a la IA que
 * esos tripwires existen, en cambio, no lo estaba: se podia reescribir entero,
 * borrar las reglas duras y nadie se enteraba. Eso ya paso una vez, y en la
 * direccion mas cara.
 *
 * Durante meses `CLAUDE.md` declaro "Fase 0 - En progreso" con el esquema
 * inicial, `auth_org_id()`, el hook de JWT y el middleware TODOS sin construir,
 * mientras habia 68 migraciones y la app llevaba meses en produccion. Una IA que
 * lee eso no duda: actua. Se pone a construir de cero lo que ya existe, o a
 * "reparar" lo que nunca estuvo roto, y de paso reescribe rutas cuya
 * autorizacion no entiende. Un contexto desactualizado es PEOR que no tener
 * contexto, porque no tener contexto al menos obliga a mirar el codigo.
 *
 * Dos capas:
 *
 *   1. Las reglas que no pueden desaparecer. Cada una es la ultima linea de
 *      defensa de algo que ya se rompio o casi. Si alguien reescribe el archivo
 *      y se lleva una por delante, aqui se entera.
 *   2. Las mentiras conocidas. Frases que estuvieron en el archivo, eran falsas
 *      y costaron caro. Si vuelven, vuelve el problema.
 *
 * Determinista: lee un archivo de disco. No toca red ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONTEXTO = join(process.cwd(), 'CLAUDE.md')
const src = readFileSync(CONTEXTO, 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reglas que no pueden desaparecer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clave = por que existe la regla, en una linea. Valor = como se reconoce.
 *
 * CADA PATRON ANCLA EN LA PROHIBICION, NO EN EL SIMBOLO. La primera version de
 * este archivo buscaba solo que la palabra apareciera (`/sanitizeRichText/`), y
 * al probarlo se descubrio que invertir la regla a "Se puede quitar
 * sanitizeRichText" dejaba el test EN VERDE: la palabra seguia ahi. Un tripwire
 * que confirma que se menciona el tema, y no que se prohibe la accion, da la
 * calma sin el control. Por eso ahora el patron exige el verbo de prohibicion
 * ("no quitar", "nunca", "se salta") pegado al simbolo.
 *
 * Queda holgura para redactar mejor: lo que se fija es la prohibicion, no la
 * prosa completa.
 */
const REGLAS: Record<string, RegExp> = {
  'el admin client SE SALTA el RLS y el unico candado es el if de la ruta':
    /createAdminClient\(\)[^\n]{0,12}se salta el RLS/i,

  'la autorizacion de flujos vive en resolveFlowAccess y no se replica':
    /resolveFlowAccess[\s\S]{0,200}(única|unica) fuente de verdad/i,

  'un permiso de solo ver es TECHO, no piso':
    /techo/i,

  'los tripwires no se arreglan aflojandolos':
    /aflojar el test/i,

  'NO QUITAR los guardas readOnly del editor de flujos':
    /No quitar los guardas `?readOnly/i,

  'NO QUITAR sanitizeRichText':
    /No quitar `?sanitizeRichText/i,

  'el porque de sanitizeRichText: la CSP trae unsafe-inline':
    /unsafe-inline/,

  'nada de directorios de codigo fuera de src/':
    /No se crean directorios de c[oó]digo nuevos/i,

  'no hay sistema de plugins y no se va a construir uno':
    /No hay sistema de plugins y no se va a construir uno/i,

  'NUNCA escribir al filesystem en runtime':
    /Nunca escribir al filesystem/i,

  'NUNCA armar rutas de disco con entrada del usuario (path traversal)':
    /Nunca construir una ruta de disco[\s\S]{0,200}path traversal/i,

  'correr type-check y test antes de subir':
    /npm run type-check[\s\S]{0,120}npm test/,

  'NUNCA push directo a master':
    /Nunca hacer push a `master`/i,

  'prohibido el guion largo':
    /Prohibido el guion largo/i,

  'el texto visible en espanol lleva ñ y tildes':
    /lleva ñ y tildes/i,

  'si el archivo no coincide con el codigo, gana el codigo':
    /gana el c[oó]digo/i,
}

describe('CLAUDE.md: las reglas duras siguen escritas', () => {
  it('ninguna regla desaparecio del contexto', () => {
    // Se juntan TODAS las que faltan y se falla una sola vez con la lista
    // completa, igual que en el tripwire de flujos. Si una reescritura se lleva
    // seis reglas, el rojo tiene que nombrar las seis a la primera, no obligar a
    // seis vueltas de reponer-y-volver-a-correr.
    const faltantes = Object.entries(REGLAS)
      .filter(([, patron]) => !patron.test(src))
      .map(([porque]) => porque)

    expect(
      faltantes,
      'CLAUDE.md perdio reglas duras. Cada una protege algo que ya se rompio:',
    ).toEqual([])
  })

  it('la seccion de reglas duras sigue al principio, donde se lee', () => {
    // Una regla enterrada en la linea 400 es una regla que nadie lee. El valor
    // de este archivo depende de que lo primero que aparezca sea lo que no se
    // puede romper.
    const posicion = src.indexOf('REGLAS DURAS')
    expect(posicion, 'no existe la seccion REGLAS DURAS').toBeGreaterThan(-1)
    expect(
      posicion,
      'las REGLAS DURAS se movieron demasiado abajo del archivo',
    ).toBeLessThan(1500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mentiras conocidas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frases que estuvieron en el archivo, eran falsas, y llevaron a alguien (o a
 * alguna IA) a hacer trabajo equivocado. No es una lista de estilo: cada entrada
 * tiene un costo pagado detras.
 */
const MENTIRAS: { patron: RegExp; porque: string }[] = [
  {
    patron: /Fase 0 [-—–] En progreso/i,
    porque:
      'el proyecto NO esta en Fase 0, lleva meses en produccion con 68 migraciones',
  },
  {
    patron: /\[ \] `supabase\/migrations\/0001_initial_schema\.sql`/,
    porque: 'el esquema inicial existe desde hace meses, no es un pendiente',
  },
  {
    patron: /\[ \] Funci[oó]n `auth_org_id\(\)`/,
    porque: 'auth_org_id() existe y la usan las policies RLS',
  },
  {
    patron: /\[ \] `src\/middleware\.ts`/,
    porque: 'el middleware existe y hace la restriccion por dominio',
  },
  {
    patron: /next\.config\.ts/,
    porque: 'el archivo real es next.config.mjs, no .ts',
  },
  {
    patron: /@tudominio\.com/,
    porque:
      'el dominio no esta quemado en el codigo, viene de ALLOWED_EMAIL_DOMAINS',
  },
]

describe('CLAUDE.md: no volvieron las afirmaciones falsas', () => {
  for (const { patron, porque } of MENTIRAS) {
    it(`no dice algo falso: ${porque}`, () => {
      expect(patron.test(src), `CLAUDE.md volvio a afirmar algo falso. ${porque}`).toBe(
        false,
      )
    })
  }

  it('declara explicitamente que el proyecto esta en produccion', () => {
    // El opuesto de la mentira no basta con quitarlo: hay que afirmarlo. Un
    // archivo que simplemente no menciona el estado deja que la IA lo suponga, y
    // suponer "proyecto nuevo" es el default de cualquier modelo.
    expect(/EN PRODUCCI[OÓ]N/i.test(src)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. La regla del guion largo se cumple en el propio archivo
// ─────────────────────────────────────────────────────────────────────────────

describe('CLAUDE.md: predica con el ejemplo', () => {
  it('no usa guiones largos, salvo donde nombra el caracter prohibido', () => {
    // Un archivo que prohibe el guion largo y trae nueve adentro le ensena al
    // lector que la regla es decorativa. La unica excepcion legitima es la linea
    // que NOMBRA los caracteres para poder prohibirlos.
    const ofensores = src
      .split('\n')
      .map((linea, i) => [i + 1, linea] as const)
      .filter(([, linea]) => /[—–]/.test(linea))
      .filter(([, linea]) => !/prohibido el guion largo/i.test(linea))
      .map(([n, linea]) => `${n}: ${linea.trim().slice(0, 70)}`)

    expect(ofensores, 'CLAUDE.md tiene guiones largos').toEqual([])
  })
})
