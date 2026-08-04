/**
 * Comprobacion de la URL de una herramienta ANTES de proponerla.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────
 * Las tres formas en que una herramienta "no carga" son invisibles desde el
 * formulario y tardan dias en descubrirse:
 *
 *   1. La URL no responde, o responde 404 porque la ruta del embed no es esa.
 *   2. El deploy esta detras de la proteccion de Vercel y contesta 302 al login.
 *      Dentro del marco eso no se ve como un error: se ve como si tu
 *      herramienta fuera la pantalla de acceso de otro.
 *   3. La herramienta se niega a si misma a ser enmarcada
 *      (`X-Frame-Options: DENY` o un `frame-ancestors` que no incluye a WLO).
 *
 * Las tres se detectan con una peticion desde el servidor. Hacerlo aqui, al
 * teclear, cuesta un segundo; descubrirlo despues cuesta una tarde de alguien
 * mirando un recuadro en blanco.
 *
 * ── Por que la mitad del archivo es una lista negra de direcciones ─────────
 * Esto recibe una URL escrita por una persona y hace que EL SERVIDOR la visite.
 * Ese patron es un SSRF de manual: si no se acota, cualquier miembro puede
 * pedirle a WLO que toque `http://169.254.169.254/` (metadatos de la nube) o
 * `http://10.0.0.5:6379` (algo interno) y usar la respuesta como oraculo. Por
 * eso:
 *
 *   - Solo https. Sin excepcion de localhost, que aqui seria justo el agujero.
 *   - Se resuelve el nombre y se rechaza si apunta a una direccion privada,
 *     de bucle local, de enlace local o reservada. Se comprueban TODAS las
 *     direcciones que devuelve el DNS, no la primera: un nombre puede resolver
 *     a una publica y a una privada a la vez.
 *   - No se siguen redirecciones. Una redireccion es exactamente como se
 *     esquivaria la comprobacion de arriba.
 *   - NUNCA se devuelve el cuerpo de la respuesta. Solo el codigo y dos
 *     cabeceras. Sin eso, esto seria un proxy de lectura para lo que sea que
 *     el servidor de WLO alcance.
 */

export interface Veredicto {
  ok: boolean
  /** Codigo HTTP, o null si no se llego a hablar con nadie. */
  status: number | null
  /** Frase corta para la interfaz. */
  titulo: string
  /** Explicacion y que hacer. */
  detalle: string
  /** true = se puede pintar dentro de WLO hasta donde se puede saber desde aqui. */
  enmarcable: boolean
}

/** Solo https y un host con punto. Sin localhost: aqui seria el agujero. */
export function validarUrlPublica(raw: string): { ok: true; url: URL } | { ok: false; motivo: string } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { ok: false, motivo: 'Eso no es una URL.' }
  }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'Tiene que ser https.' }
  if (!u.hostname.includes('.')) return { ok: false, motivo: 'El dominio no parece publico.' }
  if (u.username || u.password) return { ok: false, motivo: 'La URL no puede llevar usuario ni contrasena.' }
  return { ok: true, url: u }
}

/**
 * Rangos que NO son internet. Se escriben a mano y no con una libreria porque
 * la lista es corta, no cambia, y una dependencia mas aqui es una cara mas que
 * confiar para algo que cabe en veinte lineas.
 */
export function esDireccionInterna(ip: string): boolean {
  const limpia = ip.startsWith('::ffff:') ? ip.slice(7) : ip

  // IPv4
  const v4 = limpia.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10) return true                      // 10.0.0.0/8      privada
    if (a === 127) return true                     // 127.0.0.0/8     bucle local
    if (a === 0) return true                       // 0.0.0.0/8       este host
    if (a === 169 && b === 254) return true        // 169.254.0.0/16  enlace local y metadatos
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 privada
    if (a === 192 && b === 168) return true        // 192.168.0.0/16  privada
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a >= 224) return true                      // multicast y reservadas
    return false
  }

  // IPv6
  const v6 = limpia.toLowerCase()
  if (v6 === '::1' || v6 === '::') return true
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true // fc00::/7 unicas locales
  if (v6.startsWith('fe80')) return true                      // enlace local
  return false
}

/**
 * Traduce lo que contesto el servidor a algo que una persona pueda accionar.
 * Se separa de la peticion para poder probarla sin red.
 */
export function interpretar(
  status: number,
  cabeceras: { xFrameOptions: string | null; csp: string | null },
  origenDeWlo: string,
): Veredicto {
  const xfo = (cabeceras.xFrameOptions ?? '').toLowerCase()
  const csp = (cabeceras.csp ?? '').toLowerCase()

  if (status >= 300 && status < 400) {
    return {
      ok: false,
      status,
      titulo: 'Redirige a otro lado',
      detalle:
        'Casi siempre es la proteccion de despliegue del hosting mandandote a una pantalla de acceso. Dentro de WLO eso no se ve como un error, se ve como si tu herramienta fuera un login ajeno. Registra la URL de produccion, no la de un preview, o apaga la proteccion en ese proyecto.',
      enmarcable: false,
    }
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      status,
      titulo: 'Pide autenticacion',
      detalle:
        'La URL existe pero no deja pasar sin credenciales. WLO la abre sin sesion tuya, asi que quien la vea va a ver esto mismo.',
      enmarcable: false,
    }
  }

  if (status === 404) {
    return {
      ok: false,
      status,
      titulo: 'Esa ruta no existe',
      detalle: 'El dominio responde, pero la ruta que pusiste no. Revisa la ruta del embed.',
      enmarcable: false,
    }
  }

  if (status >= 500) {
    return {
      ok: false,
      status,
      titulo: 'La herramienta esta fallando',
      detalle: 'El servidor contesto con un error propio. Revisa su deploy antes de proponerla.',
      enmarcable: false,
    }
  }

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      titulo: `Respuesta inesperada (${status})`,
      detalle: 'No es un error claro, pero tampoco un 200. Vale la pena mirarlo antes de seguir.',
      enmarcable: false,
    }
  }

  // A partir de aqui responde 200. Falta ver si se deja enmarcar.
  if (xfo.includes('deny')) {
    return {
      ok: false,
      status,
      titulo: 'Se niega a ser enmarcada',
      detalle:
        'Manda X-Frame-Options: DENY, que le prohibe al navegador pintarla dentro de otra pagina. Quitalo o cambialo por un frame-ancestors que incluya a WLO.',
      enmarcable: false,
    }
  }
  if (xfo.includes('sameorigin')) {
    return {
      ok: false,
      status,
      titulo: 'Solo se deja enmarcar por si misma',
      detalle:
        'Manda X-Frame-Options: SAMEORIGIN. Cambialo por Content-Security-Policy: frame-ancestors ' +
        origenDeWlo +
        '.',
      enmarcable: false,
    }
  }

  if (csp.includes('frame-ancestors')) {
    const trozo = csp.split('frame-ancestors')[1]?.split(';')[0] ?? ''
    const permite = trozo.includes(origenDeWlo.toLowerCase()) || trozo.includes('*')
    if (!permite) {
      return {
        ok: false,
        status,
        titulo: 'Su frame-ancestors no incluye a WLO',
        detalle:
          'Responde bien, pero su propia politica solo deja que la enmarquen otros. Agrega ' +
          origenDeWlo +
          ' a frame-ancestors.',
        enmarcable: false,
      }
    }
    return {
      ok: true,
      status,
      titulo: 'Responde y deja que WLO la enmarque',
      detalle: 'Su frame-ancestors nombra a WLO. Es lo que se espera de una herramienta de pantalla.',
      enmarcable: true,
    }
  }

  return {
    ok: true,
    status,
    titulo: 'Responde correctamente',
    detalle:
      'No declara frame-ancestors, asi que no se opone a que la enmarquen. Ponerlo apuntando solo a WLO es mejor: impide que cualquier otro sitio la enmarque.',
    enmarcable: true,
  }
}
