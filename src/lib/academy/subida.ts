/**
 * Subida del binario al storage, con PROGRESO real.
 *
 * POR QUE NO `fetch` NI `uploadToSignedUrl`. Los dos suben bien, y los dos
 * dejan al usuario mirando un boton girando durante varios minutos sin decir
 * nada. Con un video de 500MB en un enlace lento eso se lee como "se colgo" y
 * la gente recarga la pagina a la mitad. `XMLHttpRequest` es la unica API del
 * navegador que reporta progreso de SUBIDA (fetch solo reporta bajada), asi
 * que se usa a proposito aunque sea vieja.
 *
 * TRADUCCION DE ERRORES. Storage contesta en ingles y con frases que no dicen
 * que hacer: "The object exceeded the maximum allowed size" no menciona el
 * limite ni donde se cambia. Un error que no dice el siguiente paso obliga a
 * adivinar, asi que aqui se convierte en una frase que nombra la causa.
 */

export interface ResultadoSubida {
  ok: boolean
  /** Mensaje ya traducido y accionable. Vacio si ok. */
  error: string
}

export interface OpcionesSubida {
  url: string
  token: string
  archivo: File
  /** 0..100 */
  onProgreso?: (pct: number) => void
  /** Para poder cancelar desde la UI. */
  senal?: AbortSignal
}

/**
 * Traduce el error crudo del storage a algo que diga que hacer.
 * Exportada para poder probarla: es logica, no plomeria.
 */
export function traducirErrorStorage(crudo: string, tamBytes: number): string {
  const t = crudo.toLowerCase()
  const mb = Math.round(tamBytes / (1024 * 1024))

  if (t.includes('maximum allowed size') || t.includes('exceeded') || t.includes('payload too large')) {
    // El bucket admite 2GB; si aun asi rebota por tamaño, quien corta es el
    // limite GLOBAL del proyecto en Supabase, que es otro ajuste y vive en
    // otra pantalla. Decirlo evita horas buscando en el lugar equivocado.
    return `El archivo pesa ${mb} MB y Supabase lo rechazó por tamaño. El tope NO está en esta app: es el límite global de subida del proyecto (Storage > Settings > Upload file size limit). Súbelo ahí y vuelve a intentar.`
  }
  if (t.includes('jwt') || t.includes('expired') || t.includes('invalid signature')) {
    return 'La firma de subida caducó. Cierra y vuelve a abrir esta ventana para pedir una nueva.'
  }
  if (t.includes('network') || t.includes('failed to fetch') || t.length === 0) {
    return 'Se cortó la conexión durante la subida. Vuelve a intentar; no se guardó nada a medias.'
  }
  return crudo
}

export function subirConProgreso(op: OpcionesSubida): Promise<ResultadoSubida> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${op.url}?token=${encodeURIComponent(op.token)}`)
    xhr.setRequestHeader('Content-Type', op.archivo.type || 'application/octet-stream')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && op.onProgreso) {
        op.onProgreso(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, error: '' })
        return
      }
      // El cuerpo suele traer {"error":"...","message":"..."}. Si no parsea,
      // se usa el texto crudo: peor es enseñar "[object Object]".
      let msg = xhr.responseText
      try {
        const j = JSON.parse(xhr.responseText)
        msg = j.message ?? j.error ?? xhr.responseText
      } catch { /* texto crudo */ }
      resolve({ ok: false, error: traducirErrorStorage(msg, op.archivo.size) })
    }

    xhr.onerror = () => {
      resolve({ ok: false, error: traducirErrorStorage('network', op.archivo.size) })
    }
    xhr.onabort = () => {
      resolve({ ok: false, error: 'Subida cancelada.' })
    }

    if (op.senal) {
      op.senal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(op.archivo)
  })
}
