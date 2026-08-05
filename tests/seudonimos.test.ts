/**
 * Tests del sustituidor de nombres que se usa cuando el modelo NO puede ver
 * datos personales (hoy: DeepSeek).
 *
 * Lo que se prueba aqui no es "reemplaza nombres". Eso es lo facil. Se prueban
 * las cuatro maneras en que esto puede fallar DEJANDO SALIR UN NOMBRE REAL sin
 * que nadie lo note, que es el unico fallo que importa:
 *
 *   1. El orden. Con "Ana" antes que "Ana Lucia Perez" el nombre largo se
 *      reemplaza a trozos y sale "Persona 1 Lucia Perez": medio apellido real,
 *      fuera, y el texto parece perfectamente censurado.
 *   2. La identidad relativa. Si el nombre completo y el nombre de pila caen en
 *      seudonimos distintos, el modelo cree que son dos personas y parte el
 *      trabajo de una sola en dos viñetas.
 *   3. Los acentos. `\b` de JavaScript razona en ASCII: en "Peña" ve un limite
 *      entre "Pe" y "ña". Un nombre acentuado se reemplazaria a medias.
 *   4. La vuelta. Si `revelar` no deshace exactamente lo que hizo `ocultar`, la
 *      persona lee "Persona 3" en su propio reporte.
 *
 * Cada test de abajo se escribio comprobando ANTES que falla si se quita la
 * linea que lo sostiene.
 */
import { describe, it, expect } from 'vitest'
import { crearSeudonimos } from '@/lib/ai/seudonimos'

describe('El nombre real no sale, ni entero ni a trozos', () => {
  it('un nombre completo no se reemplaza a pedazos cuando el de pila tambien esta en el padron', () => {
    // El caso que rompe si se ordena por orden de llegada en vez de por largo.
    const s = crearSeudonimos(['Ana', 'Ana Lucia Perez'])
    const salida = s.ocultar('Ana Lucia Perez cerro el ticket y Ana lo reviso')

    // Ni el apellido ni el segundo nombre pueden quedar sueltos en el texto.
    expect(salida).not.toMatch(/Lucia/)
    expect(salida).not.toMatch(/Perez/)
    expect(salida).not.toMatch(/Ana/)
  })

  it('el nombre de pila suelto cae en el MISMO seudonimo que el nombre completo', () => {
    const s = crearSeudonimos(['Karla Mendez Ruiz'])
    const salida = s.ocultar('Karla Mendez Ruiz termino la junta. Karla subio las fotos.')

    const seudos = Array.from(new Set(salida.match(/Persona \d+/g) ?? []))
    // Dos menciones de la misma persona, un solo seudonimo.
    expect(seudos).toHaveLength(1)
    expect(salida).not.toMatch(/Karla/)
  })

  it('reemplaza el nombre aunque los acentos esten puestos o no', () => {
    const s = crearSeudonimos(['Karla Méndez'])
    // La gente escribe el mismo nombre de las dos formas el mismo dia.
    expect(s.ocultar('Karla Mendez reviso el sitio')).not.toMatch(/Mendez/i)
    expect(s.ocultar('Karla Méndez reviso el sitio')).not.toMatch(/Méndez/i)
  })

  it('la equivalencia de acentos funciona en LAS DOS direcciones', () => {
    // Este es el fallo que mas engaña de todos y por eso tiene test propio.
    // La regex tolera acentos, asi que llega a CASAR "Mendez" con el padron en
    // "Méndez". Si la busqueda en el mapa no tolerase lo mismo, la coincidencia
    // no encontraria seudonimo y la funcion escribiria de vuelta el nombre real
    // creyendo que no lo conocia: el texto sale INTACTO y parece que el padron
    // simplemente no incluia a esa persona.
    const conAcento = crearSeudonimos(['Karla Méndez'])
    expect(conAcento.ocultar('Karla Mendez reviso')).toBe('Persona 1 reviso')

    const sinAcento = crearSeudonimos(['Karla Mendez'])
    expect(sinAcento.ocultar('Karla Méndez reviso')).toBe('Persona 1 reviso')
  })

  it('un nombre con ñ no se parte por la mitad', () => {
    // Con `\b` de JavaScript esto saldria como "Persona 1ña" o similar.
    const s = crearSeudonimos(['Peña Nieto'])
    const salida = s.ocultar('Peña Nieto acomodo el material')
    expect(salida).not.toMatch(/ña/)
    expect(salida).toMatch(/^Persona 1 acomodo el material$/)
  })

  it('no toca palabras que solo CONTIENEN el nombre', () => {
    // "Ana" no puede convertir "Anastasia" ni "banana" en medio seudonimo.
    const s = crearSeudonimos(['Ana Torres'])
    const salida = s.ocultar('Anastasia trajo una banana')
    expect(salida).toBe('Anastasia trajo una banana')
  })
})

describe('Cuando el nombre es ambiguo, no se adivina', () => {
  it('un nombre de pila que comparten dos personas se deja como esta', () => {
    // Dos Karlas: "Karla" a secas no identifica a nadie. Asignarla a una de las
    // dos seria inventar, y el modelo escribiria el trabajo de una en la otra.
    const s = crearSeudonimos(['Karla Mendez', 'Karla Ruiz'])

    // Los nombres completos si se ocultan, que son inequivocos.
    expect(s.ocultar('Karla Mendez fue a Tracy')).not.toMatch(/Mendez/)
    expect(s.ocultar('Karla Ruiz fue a Tracy')).not.toMatch(/Ruiz/)

    // El de pila suelto se queda: es el mal menor y es visible, no silencioso.
    expect(s.ocultar('Karla fue a Tracy')).toBe('Karla fue a Tracy')
  })
})

describe('La vuelta deshace exactamente la ida', () => {
  it('revelar(ocultar(x)) devuelve el texto original', () => {
    const s = crearSeudonimos(['Ana Lucia Perez', 'Carlos Diaz', 'Peña Nieto'])
    const original = 'Ana Lucia Perez y Carlos Diaz cerraron el sitio; Peña Nieto superviso'
    expect(s.revelar(s.ocultar(original))).toBe(original)
  })

  it('revelar tolera que el modelo escriba el seudonimo con otro espaciado', () => {
    const s = crearSeudonimos(['Ana Lucia Perez'])
    // Los modelos parten y rearman texto; "Persona  1" con dos espacios pasa.
    expect(s.revelar('Persona  1 cerro el ticket')).toBe('Ana Lucia Perez cerro el ticket')
  })

  it('revelar no inventa nombres para seudonimos que no existen', () => {
    const s = crearSeudonimos(['Ana Lucia Perez'])
    // Solo hay una persona. Si el modelo alucina "Persona 7", se queda tal cual
    // en vez de asignarle el nombre de alguien real.
    expect(s.revelar('Persona 7 cerro el ticket')).toBe('Persona 7 cerro el ticket')
  })
})

describe('Recorre estructuras, no solo cadenas sueltas', () => {
  it('ocultarProfundo entra en objetos y arreglos anidados', () => {
    const s = crearSeudonimos(['Carlos Diaz'])
    const entrada = {
      resumen: 'Carlos Diaz cerro tres tickets',
      items: [{ persona: 'Carlos Diaz', horas: 8 }],
      activo: true,
    }
    const salida = s.ocultarProfundo(entrada)

    expect(salida.resumen).not.toMatch(/Carlos/)
    expect(salida.items[0].persona).not.toMatch(/Carlos/)
    // Lo que no es texto se queda igual, sin convertirse en string.
    expect(salida.items[0].horas).toBe(8)
    expect(salida.activo).toBe(true)
  })

  it('revelarProfundo deshace ocultarProfundo', () => {
    const s = crearSeudonimos(['Carlos Diaz'])
    const entrada = { items: [{ persona: 'Carlos Diaz' }] }
    expect(s.revelarProfundo(s.ocultarProfundo(entrada))).toEqual(entrada)
  })
})

describe('La version inerte no cuesta nada y no estorba', () => {
  it('apagado, el texto pasa intacto', () => {
    const s = crearSeudonimos(['Carlos Diaz'], false)
    expect(s.activo).toBe(false)
    expect(s.ocultar('Carlos Diaz cerro el ticket')).toBe('Carlos Diaz cerro el ticket')
  })

  it('un padron vacio o basura no rompe nada', () => {
    for (const padron of [[], [''], ['   '], ['a']]) {
      const s = crearSeudonimos(padron)
      expect(s.activo).toBe(false)
      expect(s.ocultar('texto cualquiera')).toBe('texto cualquiera')
    }
  })

  it('un nombre con caracteres de regex no rompe el patron', () => {
    // Un display_name con parentesis o punto llegaria a `new RegExp` y, sin
    // escapar, tumbaria toda la IA con un error de sintaxis de regex.
    const s = crearSeudonimos(['Ana (temporal) Perez.'])
    expect(() => s.ocultar('Ana (temporal) Perez. reviso el sitio')).not.toThrow()
    expect(s.ocultar('Ana (temporal) Perez. reviso el sitio')).not.toMatch(/Ana/)
  })
})

describe('Lo que el troceado del streaming necesita', () => {
  it('largoMaximo cubre el seudonimo mas largo que puede generar', () => {
    const s = crearSeudonimos(Array.from({ length: 12 }, (_, i) => `Persona Real ${i} Apellido`))
    const masLargo = `Persona ${s.total}`
    expect(s.largoMaximo).toBeGreaterThanOrEqual(masLargo.length)
  })

  it('retiene un seudonimo que quedo partido al final del trozo', () => {
    const s = crearSeudonimos(['Ana Perez'])
    // Llego "...cerro el ticket Persona" y el " 1" viene en el siguiente trozo.
    const trozo = 'cerro el ticket Persona'
    expect(s.corteSeguro(trozo)).toBe(trozo.indexOf('Persona'))
  })

  it('retiene tambien cuando ya llego el numero, porque puede tener otro digito', () => {
    // El caso que de verdad hace daño: si el texto real es "Persona 12" y se
    // corta antes del "2", la cola "Persona 1" casa igual y saldria el nombre
    // de OTRA persona, bien escrito y en la frase equivocada.
    const s = crearSeudonimos(['Ana Perez', 'Luis Diaz'])
    const trozo = 'lo reviso Persona 1'
    expect(s.corteSeguro(trozo)).toBe(trozo.indexOf('Persona 1'))
  })

  it('no retiene nada cuando el final no puede ser un seudonimo', () => {
    const s = crearSeudonimos(['Ana Perez'])
    const trozo = 'cerro el ticket y se fue.'
    expect(s.corteSeguro(trozo)).toBe(trozo.length)
  })

  it('rearmar el texto por trozos da lo mismo que traducirlo entero', () => {
    const s = crearSeudonimos(['Ana Perez', 'Luis Diaz'])
    const completo = 'Persona 1 cerro el ticket y Persona 2 lo reviso'

    // Se simula el chorro del modelo cortando en cada caracter, que es el peor
    // caso posible y el que parte todos los seudonimos.
    let pendiente = ''
    let salida = ''
    for (const ch of completo) {
      pendiente += ch
      const corte = s.corteSeguro(pendiente)
      salida += s.revelar(pendiente.slice(0, corte))
      pendiente = pendiente.slice(corte)
    }
    salida += s.revelar(pendiente)

    expect(salida).toBe(s.revelar(completo))
    expect(salida).toBe('Ana Perez cerro el ticket y Luis Diaz lo reviso')
  })
})
