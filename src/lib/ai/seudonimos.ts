/**
 * Seudonimos: los nombres de las personas no salen de aqui.
 *
 * POR QUE EXISTE. El reporte diario es, literalmente, quien hizo que cada dia.
 * Mientras el modelo fue Gemini eso viajaba a Google como cualquier otro dato
 * del producto. Al mover la IA a DeepSeek cambia el pais y la empresa que lo
 * recibe, y la regla de la casa es clara: a DeepSeek solo datos agregados, sin
 * datos personales. Un reporte de trabajo es lo contrario de agregado.
 *
 * QUE HACE Y QUE NO HACE. Sustituye los nombres del padron del espacio por
 * "Persona 1", "Persona 2"... antes de mandar nada, y los devuelve al recibir.
 * El modelo redacta sobre gente sin nombre y nosotros volvemos a ponerselos.
 *
 * Lo que NO hace, y conviene tenerlo escrito para no creer que protege mas de
 * lo que protege: el TEXTO de la actividad sigue viajando. Si alguien escribe
 * "llame al cliente Juan Perez del Home Depot de Tracy", ese nombre no esta en
 * el padron y sale tal cual. Esto quita a las personas del equipo del material
 * que sale, no convierte el reporte en anonimo. Decir lo contrario seria
 * exactamente el tipo de aviso que miente que se acaba de quitar del producto.
 *
 * POR QUE SEUDONIMO Y NO BORRADO. Borrar el nombre obligaria al modelo a
 * redactar sin saber cuantas personas distintas hay, y juntaria en una sola
 * viñeta el trabajo de dos. El seudonimo conserva la identidad relativa (que
 * Persona 1 y Persona 2 son distintas) sin decir quienes son, que es justo lo
 * que el modelo necesita y lo unico que necesita.
 */

/** Vocales acentuadas: la gente escribe "Mendez" y "Méndez" el mismo dia. */
const EQUIVALENTES: Record<string, string> = {
  a: '[aáà]',
  e: '[eéè]',
  i: '[iíì]',
  o: '[oóò]',
  u: '[uúùü]',
  n: '[nñ]',
  c: '[cç]',
}

/**
 * Forma canonica con la que se GUARDA y se BUSCA cualquier nombre.
 *
 * Tiene que seguir exactamente la misma regla que `patronDeNombre`, y no es un
 * detalle de estilo: la regex tolera acentos, asi que con el padron en "Méndez"
 * llega a casar el texto "Mendez". Si la busqueda en el mapa fuera sensible al
 * acento, esa coincidencia devolveria undefined y `ocultar` caeria en su
 * `|| m`, es decir, escribiria de vuelta EL NOMBRE REAL creyendo que no lo
 * conocia. Silencioso y al reves de lo que promete el modulo.
 */
function claveDeBusqueda(texto: string): string {
  return Array.from(texto.toLowerCase())
    .map(ch => ch.normalize('NFD')[0])
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Escapa lo que es especial en una regex y tolera acentos puestos o no. */
function patronDeNombre(nombre: string): string {
  return nombre
    .split('')
    .map(ch => {
      // Se quita el acento ANTES de buscar en la tabla, o la equivalencia solo
      // funcionaria en una direccion: con el padron en "Mendez" se reconoceria
      // "Méndez", pero con el padron en "Méndez" NO se reconoceria "Mendez",
      // que es justo como lo escribe la mayoria de la gente al teclear rapido.
      //
      // NFD parte "é" en "e" + acento suelto y deja la letra base de PRIMERA,
      // asi que [0] es esa letra. Sirve igual para ñ (n), ü (u) y ç (c).
      const base = ch.toLowerCase().normalize('NFD')[0]
      if (EQUIVALENTES[base]) return EQUIVALENTES[base]
      // Cualquier cosa que pueda romper la regex se escapa.
      return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
}

/**
 * Limite de palabra que funciona con acentos y ñ.
 *
 * `\b` de JavaScript razona en ASCII: en "Peña" ve un limite entre "Pe" y "ña",
 * asi que un nombre acentuado se reemplazaria a medias y saldria basura. Con
 * lookarounds sobre categorias Unicode el limite es de verdad.
 */
function conLimites(cuerpo: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${cuerpo})(?![\\p{L}\\p{N}])`, 'giu')
}

/** La palabra con la que empieza todo seudonimo. Solo se escribe una vez. */
const PREFIJO = 'Persona'

/**
 * Hasta que posicion de `texto` es seguro traducir cuando aun falta texto por
 * llegar. Devuelve el largo completo si no hay nada pendiente.
 *
 * ESTO EXISTE POR EL STREAMING. El modelo escribe a chorros y "Persona 1" puede
 * llegar partido en dos: "Persona" en un trozo y " 1" en el siguiente. Si se
 * traduce cada trozo por separado, ninguno de los dos casa con nada y la
 * persona ve "Persona 1" en pantalla, en crudo, en su propio reporte.
 *
 * Peor todavia es el caso contrario y por eso no basta con guardar unos
 * caracteres al azar: si el texto real era "Persona 12" y se corta justo antes
 * del "2", la cola "Persona 1" SI casa (al final de la cadena no hay ninguna
 * letra que impida el limite de palabra) y se traduciria con el nombre de la
 * persona equivocada. Un nombre real, correctamente escrito, en la frase de
 * otro. Nadie lo leeria como un error.
 *
 * Asi que se retiene desde donde empiece algo que PUEDA ser un seudonimo a
 * medias, y solo eso.
 */
function corteSeguro(texto: string): number {
  const parcial = new RegExp(`^${PREFIJO}\\s*\\d*$`, 'i')
  // Basta mirar la cola: un seudonimo partido siempre queda al final.
  const desde = Math.max(0, texto.length - (PREFIJO.length + 8))
  for (let i = desde; i < texto.length; i++) {
    const cola = texto.slice(i)
    const puedeSerlo =
      PREFIJO.toLowerCase().startsWith(cola.toLowerCase()) || parcial.test(cola)
    if (puedeSerlo) return i
  }
  return texto.length
}

export interface Seudonimos {
  /** Si esta apagado, todo es identidad y no cuesta nada tenerlo puesto. */
  readonly activo: boolean
  /** Cuantos nombres vigila. Util para logs y para los tests. */
  readonly total: number
  /** Largo del seudonimo mas largo. Lo necesita el troceado del streaming. */
  readonly largoMaximo: number
  /** Nombre real -> seudonimo. Se usa en lo que SALE hacia el modelo. */
  ocultar(texto: string): string
  /** Seudonimo -> nombre real. Se usa en lo que VUELVE del modelo. */
  revelar(texto: string): string
  /** Igual que ocultar, recorriendo un objeto o arreglo cualquiera. */
  ocultarProfundo<T>(valor: T): T
  /** Igual que revelar, recorriendo un objeto o arreglo cualquiera. */
  revelarProfundo<T>(valor: T): T
  /**
   * Cuanto de `texto` se puede traducir ya, sabiendo que va a llegar mas.
   * Lo usa el troceado del streaming; ver `corteSeguro`.
   */
  corteSeguro(texto: string): number
}

/** Version inerte. Se devuelve cuando el proveedor SI puede ver nombres. */
const INERTE: Seudonimos = {
  activo: false,
  total: 0,
  largoMaximo: 0,
  ocultar: t => t,
  revelar: t => t,
  ocultarProfundo: v => v,
  revelarProfundo: v => v,
  // Apagado no hay nada que traducir, asi que nunca hace falta retener nada.
  corteSeguro: t => t.length,
}

/** Recorre strings dentro de objetos y arreglos sin tocar el resto de tipos. */
function mapearHondo<T>(valor: T, fn: (s: string) => string): T {
  if (typeof valor === 'string') return fn(valor) as unknown as T
  if (Array.isArray(valor)) return valor.map(v => mapearHondo(v, fn)) as unknown as T
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[k] = mapearHondo(v, fn)
    }
    return salida as unknown as T
  }
  return valor
}

/**
 * Arma el sustituidor a partir del padron de nombres del espacio.
 *
 * @param nombres  display_name de los miembros. Se aceptan repetidos y vacios.
 * @param activo   false devuelve la version inerte, sin coste ni riesgo.
 */
export function crearSeudonimos(nombres: string[], activo = true): Seudonimos {
  if (!activo) return INERTE

  // Se ordena por largo DESCENDENTE y es la linea que sostiene todo lo demas.
  // Con "Ana" antes que "Ana Lucia Perez", el nombre largo se reemplazaria a
  // trozos y quedaria "Persona 1 Lucia Perez": medio nombre real, fuera, sin
  // que nadie lo note.
  const limpios = Array.from(
    new Set(nombres.map(n => (n ?? '').trim()).filter(n => n.length >= 2))
  ).sort((a, b) => b.length - a.length)

  if (limpios.length === 0) return INERTE

  // El seudonimo se asigna por PERSONA, no por variante del nombre: el nombre
  // completo y el nombre de pila tienen que caer en el mismo "Persona N" o el
  // modelo creeria que son dos personas distintas.
  const aSeudonimo = new Map<string, string>()
  const deSeudonimo = new Map<string, string>()
  const variantes: string[] = []

  // PRIMERA PASADA: los nombres COMPLETOS, que son los del padron. Un nombre
  // completo SIEMPRE se mapea y nunca se descarta. Es la diferencia entre las
  // dos cosas que aqui parecian iguales: un nombre completo es un dato real de
  // una persona real y dejarlo pasar es la fuga que todo esto viene a evitar;
  // un nombre de pila DEDUCIDO es una conveniencia y puede sacrificarse.
  limpios.forEach((nombre, i) => {
    const seudo = `Persona ${i + 1}`
    deSeudonimo.set(claveDeBusqueda(seudo), nombre)
    aSeudonimo.set(claveDeBusqueda(nombre), seudo)
    variantes.push(nombre)
  })

  // SEGUNDA PASADA: los nombres de pila deducidos. En un chat nadie escribe
  // "termine la junta con Karla Mendez Ruiz", escribe "con Karla".
  const pilasDeducidas = new Set<string>()

  limpios.forEach((nombre, i) => {
    const pila = nombre.split(/\s+/)[0]
    if (!pila || pila.length < 3 || pila === nombre) return
    const clave = claveDeBusqueda(pila)

    if (aSeudonimo.has(clave)) {
      // Si quien ya ocupa el lugar es otra PILA deducida, entonces hay dos
      // Karlas y "Karla" a secas no identifica a nadie: se descartan las dos,
      // porque adivinar repartiria el trabajo de una en la otra.
      //
      // Si quien lo ocupa es un nombre COMPLETO del padron (alguien que se
      // llama "Ana" y ademas hay una "Ana Lucia Perez"), no se toca nada: ese
      // mapeo se queda. Descartarlo dejaria salir el nombre real de "Ana", que
      // es justamente lo que no puede pasar.
      if (pilasDeducidas.has(clave)) aSeudonimo.set(clave, '')
      return
    }

    aSeudonimo.set(clave, `Persona ${i + 1}`)
    pilasDeducidas.add(clave)
    variantes.push(pila)
  })

  const utiles = variantes.filter(v => aSeudonimo.get(claveDeBusqueda(v)))
  if (utiles.length === 0) return INERTE

  utiles.sort((a, b) => b.length - a.length)
  const reOcultar = conLimites(utiles.map(patronDeNombre).join('|'))
  const reRevelar = conLimites(
    Array.from(deSeudonimo.keys())
      .sort((a, b) => b.length - a.length)
      .map(s => s.replace(/\s+/g, '\\s+'))
      .join('|')
  )

  const largoMaximo = Math.max(...Array.from(deSeudonimo.keys()).map(s => s.length))

  const ocultar = (texto: string): string =>
    texto.replace(reOcultar, m => aSeudonimo.get(claveDeBusqueda(m)) || m)

  const revelar = (texto: string): string =>
    texto.replace(reRevelar, m => deSeudonimo.get(claveDeBusqueda(m)) ?? m)

  return {
    activo: true,
    total: limpios.length,
    largoMaximo,
    ocultar,
    revelar,
    ocultarProfundo: <T,>(v: T) => mapearHondo(v, ocultar),
    revelarProfundo: <T,>(v: T) => mapearHondo(v, revelar),
    corteSeguro,
  }
}
