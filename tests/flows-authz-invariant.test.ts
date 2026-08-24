/**
 * Tripwire de AUTORIZACION del modulo de FLUJOS (flows).
 *
 * El capstone (authz-coverage-capstone) exige que cada familia de rutas tenga un
 * tripwire propio que declare, campo por campo, quien puede hacer que. Flows no lo
 * tenia, y el hueco no era teorico: la ruta /api/flows/[flowId]/members devolvia el
 * directorio completo (con CORREOS) del workspace dueño del flujo a cualquier
 * persona autenticada que tuviera un uuid de flujo, de cualquier inquilino. Solo
 * pedia sesion. Este archivo existe para que eso no pueda volver en silencio.
 *
 * Tres capas, de fuera hacia dentro:
 *
 *   1. REGISTRO ESTRUCTURAL. Cada route.ts de flows menciona su gate. Es grep, no
 *      ejecucion: barato y no se puede "olvidar" al agregar una ruta nueva.
 *   2. TABLA DE VERDAD de `resolveFlowAccess`, que es donde vive la regla de verdad.
 *      Se ejecuta contra un admin client de mentira, asi que no toca red ni DB.
 *   3. SUMIDERO DE HTML. El nodo de tipo `html` guarda markup de una persona y lo
 *      pinta OTRA (los flujos se comparten). La CSP del proyecto trae
 *      'unsafe-inline', asi que sanear al pintar es la unica barrera real.
 *
 * Determinista: lee fuentes y ejecuta una funcion pura contra dobles de prueba.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveFlowAccess, type FlowAccess } from '@/lib/flows/access'

const API = join(process.cwd(), 'src', 'app', 'api', 'flows')
const EDITOR = join(
  process.cwd(),
  'src', 'app', '(app)', 'w', '[workspaceSlug]', 'flows', '[flowId]', 'FlowEditor.tsx',
)

const leer = (...partes: string[]) => readFileSync(join(API, ...partes), 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// 1. Registro estructural
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada ruta con el gate que le toca. Si se agrega una ruta a flows y no se
 * registra aqui, el ultimo test de esta seccion la delata: el registro tiene que
 * cubrir el directorio completo, no solo lo que alguien recordo anotar.
 */
const REGISTRO: Record<string, RegExp[]> = {
  // Listar y crear: membresia explicita del workspace, autoria desde la sesion.
  'route.ts': [/workspace_members/, /created_by: user\.id/, /applyRateLimit/],
  // Leer, editar y borrar un flujo: nivel de acceso resuelto, y editar exige 'edit'.
  //
  // Las tres ultimas se agregaron despues, y no por simetria: son garantias que
  // el modulo YA daba y que ningun tripwire miraba. Se descubrio revisando una
  // rama que reescribia este archivo y borraba las tres de una sentada, sin
  // tocar `resolveFlowAccess` ni `access !== 'edit'`, asi que las dos lineas de
  // arriba habrian seguido en verde mientras el modulo perdia:
  //   - que la lista de con quien esta compartido sea del duenno (si no, quien
  //     tiene "solo ver" se entera de a quien mas se lo compartieron),
  //   - que cambiar la visibilidad sea del duenno y no de cualquiera que edite
  //     (si no, un colaborador puede volver privado un flujo del equipo, o al
  //     reves, publicar uno privado),
  //   - que exista el candado optimista con 409 (si no, dos personas editando
  //     a la vez se pisan y la ultima en guardar gana en silencio).
  // Un tripwire que cubre la puerta principal y deja tres ventanas abiertas da
  // la calma sin el control, que es el mismo fallo que el escaneo ciego.
  '[flowId]/route.ts': [
    /resolveFlowAccess\(/,
    /access !== 'edit'/,
    /applyRateLimit/,
    /flow\.created_by === user\.id \|\| access === 'edit'/,
    /parsed\.data\.visibility !== undefined && flow\.created_by !== user\.id/,
    /expected_updated_at/,
    /status: 409/,
  ],
  // Directorio del equipo: mismo gate que leer el flujo. Devuelve correos.
  '[flowId]/members/route.ts': [/resolveFlowAccess\(/, /applyRateLimit/],
  // Repartir accesos: solo el creador, y solo hacia dentro del workspace.
  '[flowId]/shares/route.ts': [
    /flow\.created_by !== user\.id/,
    /workspace_members/,
    /applyRateLimit/,
  ],
}

describe('Flows: registro estructural de gates por ruta', () => {
  for (const [ruta, patrones] of Object.entries(REGISTRO)) {
    it(`${ruta} conserva su gate`, () => {
      const src = leer(...ruta.split('/'))
      // El archivo tiene que tener contenido antes de afirmar nada sobre el.
      expect(src.length).toBeGreaterThan(200)
      // Se juntan TODOS los que faltan y se falla una sola vez con la lista
      // completa. Antes esto era un `expect` por patron dentro del bucle, que
      // corta en el primero: si una reescritura del archivo se lleva cuatro
      // gates por delante, el error solo nombra uno, se repone ese, se vuelve a
      // correr y aparece el siguiente. Cuatro vueltas para enterarse de algo que
      // se sabia desde la primera. El rojo tiene que decir todo lo que esta mal.
      const faltantes = patrones.filter((p) => !p.test(src)).map(String)
      expect(faltantes, `${ruta} perdio gates`).toEqual([])
    })
  }

  it('toda ruta de flows con admin client valida el uuid del segmento dinamico', () => {
    for (const ruta of Object.keys(REGISTRO)) {
      if (!ruta.includes('[')) continue
      const src = leer(...ruta.split('/'))
      expect(src.includes('isUuid('), `${ruta} no valida el uuid de la ruta`).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tabla de verdad de resolveFlowAccess
// ─────────────────────────────────────────────────────────────────────────────

interface Fixtures {
  membership?: { role: string } | null
  profile?: { org_role: string | null } | null
  share?: { permission: string } | null
}

/**
 * Admin client de mentira. Devuelve, por tabla, lo que diga el fixture. Encadena
 * `.select().eq().eq().maybeSingle()` porque esa es la forma exacta que usa
 * `resolveFlowAccess`; si la forma cambia, este doble deja de responder y el test
 * falla, que es justo lo que se quiere.
 */
function adminFalso(f: Fixtures) {
  const porTabla: Record<string, unknown> = {
    workspace_members: f.membership ?? null,
    profiles: f.profile ?? null,
    flow_shares: f.share ?? null,
  }
  return {
    from(tabla: string) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        maybeSingle: async () => ({ data: porTabla[tabla] ?? null, error: null }),
      }
      return cadena
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const BASE = {
  flowId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
}

const resolver = (
  f: Fixtures,
  extra: Partial<{ createdBy: string | null; visibility: string }> = {},
): Promise<FlowAccess> =>
  resolveFlowAccess(adminFalso(f), {
    ...BASE,
    createdBy: extra.createdBy !== undefined ? extra.createdBy : 'otra-persona',
    visibility: extra.visibility ?? 'workspace',
  })

describe('Flows: tabla de verdad de resolveFlowAccess', () => {
  it('sin membresia en el workspace no hay acceso, aunque exista un share', async () => {
    // Es la regla que hace que salir del workspace revoque el acceso solo. Si
    // algun dia el share bastara por si mismo, un ex-miembro conservaria la
    // llave para siempre.
    expect(await resolver({ membership: null, share: { permission: 'edit' } })).toBe('none')
  })

  it('sin membresia no hay acceso ni siendo owner de la organizacion', async () => {
    expect(
      await resolver({ membership: null, profile: { org_role: 'owner' } }),
    ).toBe('none')
  })

  it('quien creo el flujo siempre puede editar, incluso si es privado', async () => {
    expect(
      await resolver(
        { membership: { role: 'member' } },
        { createdBy: BASE.userId, visibility: 'private' },
      ),
    ).toBe('edit')
  })

  it('el admin del workspace puede editar', async () => {
    expect(await resolver({ membership: { role: 'admin' } })).toBe('edit')
  })

  it('owner y admin de la organizacion pueden editar', async () => {
    for (const rol of ['owner', 'admin']) {
      expect(
        await resolver({ membership: { role: 'member' }, profile: { org_role: rol } }),
      ).toBe('edit')
    }
  })

  it('un share de solo lectura es TECHO: no se puede editar aunque la visibilidad lo permitiera', async () => {
    // Este es el corazon del modulo. Compartir "solo ver" es una decision
    // deliberada y pesa mas que la regla general de colaboracion abierta. Si esto
    // se invierte, "solo ver" se vuelve decorativo.
    expect(
      await resolver(
        { membership: { role: 'member' }, share: { permission: 'view' } },
        { visibility: 'workspace' },
      ),
    ).toBe('view')
  })

  it('un share de edicion abre un flujo privado', async () => {
    expect(
      await resolver(
        { membership: { role: 'member' }, share: { permission: 'edit' } },
        { visibility: 'private' },
      ),
    ).toBe('edit')
  })

  it('un permiso desconocido en el share degrada a solo lectura, nunca a edicion', async () => {
    // Fallar hacia el lado seguro: si mañana entra un valor raro en la columna,
    // que no se convierta en permiso de escritura.
    expect(
      await resolver({ membership: { role: 'member' }, share: { permission: 'dueño' } }),
    ).toBe('view')
  })

  it('un flujo privado sin share es invisible para el resto del workspace', async () => {
    expect(
      await resolver({ membership: { role: 'member' } }, { visibility: 'private' }),
    ).toBe('none')
  })

  it('un flujo visible para el workspace es colaborativo', async () => {
    for (const v of ['workspace', 'team', 'project']) {
      expect(await resolver({ membership: { role: 'member' } }, { visibility: v })).toBe('edit')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sumidero de HTML
// ─────────────────────────────────────────────────────────────────────────────

describe('Flows: el HTML del usuario nunca se pinta crudo', () => {
  it('el preview de HTML usa iframe srcDoc (sin dangerouslySetInnerHTML)', () => {
    const src = readFileSync(EDITOR, 'utf8')
    // El editor pinta HTML de usuario via iframe srcDoc (sandboxed), que es
    // mas seguro que dangerouslySetInnerHTML: el navegador aisla el contenido
    // en un origen opaco. Se verifica que hay al menos un srcDoc y que no hay
    // dangerouslySetInnerHTML sin sanitizeRichText.
    const iframes = src.match(/srcDoc=\{/g) ?? []
    expect(iframes.length).toBeGreaterThan(0)
    const sumideros = src.match(/dangerouslySetInnerHTML=\{\{[^}]*\}\}/g) ?? []
    for (const s of sumideros) {
      expect(s.includes('sanitizeRichText('), `sumidero sin sanear: ${s}`).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. "Privado" tiene que ser ALCANZABLE
//
// La tabla de verdad de arriba ya demostraba que un flujo privado sin share es
// invisible. Estaba en verde, y aun asi el reporte real fue "el flujo es privado
// y tester lo ve". Las dos cosas eran ciertas: la regla funcionaba y NINGUN
// flujo podia llegar a 'private', porque el boton de crear mandaba 'workspace'
// a fuego y ninguna pantalla enviaba jamas un cambio de visibilidad.
//
// Moraleja, y motivo de este bloque: una regla de acceso correcta sobre un
// estado inalcanzable no protege nada. Se fija el CAMINO, no solo la regla.
// ─────────────────────────────────────────────────────────────────────────────

describe('Flows: se puede llegar a privado y volver', () => {
  const RAIZ = join(process.cwd(), 'src', 'app', '(app)', 'w', '[workspaceSlug]', 'flows')
  const nuevo = readFileSync(join(RAIZ, 'NewFlowButton.tsx'), 'utf8')
  const editor = readFileSync(EDITOR, 'utf8')
  const detalle = readFileSync(join(RAIZ, '[flowId]', 'page.tsx'), 'utf8')

  it('un flujo nuevo NO nace abierto al workspace', () => {
    expect(nuevo).not.toMatch(/visibility:\s*'workspace'/)
    expect(nuevo).toMatch(/visibility:\s*'private'/)
  })

  it('la migracion deja el default de la columna en privado', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20260803120000_flows_private_by_default.sql'),
      'utf8',
    )
    expect(sql).toMatch(/ALTER COLUMN visibility SET DEFAULT 'private'/)
  })

  it('el editor sabe mandar un cambio de visibilidad, no solo pintarlo', () => {
    expect(editor).toContain('cambiarVisibilidad')
    // El PATCH con visibility es el unico camino real: sin esto el boton seria
    // un adorno que cambia el color y no cambia quien entra.
    expect(editor).toMatch(/body:JSON\.stringify\(\{visibility:nueva\}\)/)
  })

  it('el boton de alcance solo se le ofrece al duenno', () => {
    // La API contesta 403 a cualquier otro. Si la UI lo ofreciera igual, el
    // usuario veria un boton que "no hace nada" y no sabria por que.
    expect(editor).toContain('esDuenno')
    expect(editor).toMatch(/disabled=\{!esDuenno/)
    expect(detalle).toMatch(/const esDuenno = flow\.created_by === user\.id/)
  })

  it('la pantalla recibe el alcance real, no un supuesto', () => {
    expect(detalle).toMatch(/flow\.visibility/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. El listado no puede ser mas angosto que el permiso
//
// Esta capa nace de una regresion real: en la rama de plugins el listado se
// habia reducido a `created_by = yo`. La regla de acceso seguia impecable, los
// 24 tests de la tabla de verdad seguian verdes, y compartir un flujo privado
// dejo de funcionar de todas formas: el destinatario recibia el permiso, la API
// lo dejaba entrar, y ninguna pantalla le nombraba el flujo jamas.
//
// De ahi la invariante: el filtro que decide QUE VES no puede ser mas angosto
// que la regla que decide QUE PUEDES ABRIR. Cuando lo es, compartir se vuelve
// decoracion, y el sintoma no aparece en ninguna prueba de la regla.
// ─────────────────────────────────────────────────────────────────────────────

describe('Flows: el listado no puede olvidar lo compartido', () => {
  const listado = readFileSync(
    join(process.cwd(), 'src', 'app', '(app)', 'w', '[workspaceSlug]', 'flows', 'page.tsx'),
    'utf8',
  )

  it('el listado consulta los flujos que me compartieron', () => {
    expect(listado).toContain('sharedFlowIds')
    expect(listado).toMatch(/id\.in\./)
  })

  it('el listado NO se reduce a lo que yo cree', () => {
    // `created_by.eq.${user.id}` dentro del `.or(...)` esta bien: suma lo mio.
    // `.eq('created_by', ...)` como filtro duro es lo que rompe, porque resta
    // todo lo demas.
    expect(listado).not.toMatch(/\.eq\(\s*'created_by'/)
    expect(listado).toContain('.or(filtro)')
  })

  it('los flujos abiertos al workspace siguen apareciendo', () => {
    expect(listado).toContain('visibility.neq.private')
    expect(listado).toContain('visibility.is.null')
  })
})
