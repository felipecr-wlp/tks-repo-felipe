/**
 * Modelo de texto que usa TODA la IA del producto (KERN, BITACORA, el desglose
 * de una actividad, el digest y las acciones de escritura).
 *
 * Se elige con la variable de entorno `IA_PROVEEDOR`. Por defecto Gemini, que
 * es lo que habia: sin tocar el entorno, esto se comporta exactamente igual
 * que antes.
 *
 *   IA_PROVEEDOR=gemini    (por defecto) Google Gemini 2.5 Flash
 *   IA_PROVEEDOR=deepseek  DeepSeek, por su API compatible con OpenAI
 *
 * POR QUE EXISTE ESTA PALANCA. El free tier de Gemini da 20 peticiones AL DIA.
 * Con dos chats y un equipo de doce personas eso se agota antes del mediodia,
 * asi que la IA del producto no estaba "fallando de vez en cuando": estaba
 * apagada la mayor parte de la jornada. Un tope de 20/dia no es un plan
 * gratuito, es una demo.
 *
 * SE ELIGE UN PROVEEDOR, NO SE ENCADENAN. Se penso en tirar de Gemini hasta
 * agotarlo y luego saltar a DeepSeek, y se descarto a proposito: daria un
 * producto que se comporta distinto segun la hora del dia (otra redaccion,
 * otra latencia, y sin imagenes despues de la peticion 20) y eso es
 * exactamente el tipo de rareza que nadie consigue reproducir ni reportar.
 * Mejor un proveedor deliberado y predecible.
 *
 * OJO CON LOS DATOS. El reporte diario lleva nombres de personas y lo que
 * cada quien hizo. Cambiar de proveedor cambia a que empresa y a que pais
 * viajan esos datos. Es una decision de gobierno de informacion, no un
 * detalle tecnico, y por eso vive en una variable de entorno explicita y no
 * en un fallback automatico que nadie ve.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV1 } from 'ai'

const PROVEEDOR = (process.env.IA_PROVEEDOR ?? 'gemini').toLowerCase()

/** DeepSeek no lee imagenes. Quien adjunte una necesita saberlo, no un error raro. */
export const MODELO_LEE_IMAGENES = PROVEEDOR !== 'deepseek'

/** Nombre legible del proveedor activo, para los logs del servidor. */
export const PROVEEDOR_IA = PROVEEDOR

function construirModelo(): LanguageModelV1 {
  if (PROVEEDOR === 'deepseek') {
    // DeepSeek habla el protocolo de OpenAI, por eso se usa ese proveedor con
    // otra baseURL en vez de una dependencia aparte.
    const deepseek = createOpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      baseURL: 'https://api.deepseek.com/v1',
      // Sin esto el SDK manda campos que la API de DeepSeek no acepta.
      compatibility: 'compatible',
    })
    return deepseek(process.env.DEEPSEEK_MODEL ?? 'deepseek-chat')
  }

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY!,
  })
  return google(process.env.GEMINI_MODEL ?? 'gemini-2.5-flash')
}

/**
 * El modelo que usan todas las rutas.
 *
 * Se llamaba `geminiFlash`. Se renombro al hacerlo configurable: un nombre que
 * dice "gemini" mientras por dentro habla DeepSeek es una mentira que se cree
 * quien lea el codigo dentro de seis meses.
 */
export const modeloTexto = construirModelo()

/**
 * ¿El fallo es "se acabó la cuota del modelo" y no "el modelo se cayó"?
 *
 * El free tier de Gemini tiene tope DIARIO (hoy 20 requests/día en
 * gemini-2.5-flash) y al agotarse la API contesta 429 RESOURCE_EXHAUSTED. Sin
 * distinguirlo, ese caso caía en el catch genérico y la persona veía "No se pudo
 * armar el reporte": un 500 que se lee como "la app está rota" y que invita a
 * reintentar, cuando lo único que pasa es que hoy ya no hay cupo. Mismo criterio
 * que `isQuotaExhausted` del rate limit: separar el estado ADMINISTRATIVO
 * (permanente hasta que corte el ciclo o se suba el plan) del incidente.
 *
 * Se inspecciona el texto porque el SDK envuelve el error del proveedor y no
 * expone un código estable que consultar.
 */
export function esCuotaDeModeloAgotada(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (err as { statusCode?: number; status?: number } | null)?.status
  if (status === 429) return true
  if (esSaldoAgotado(err)) return true
  return /RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i.test(msg)
}

/**
 * Caso aparte del anterior: la cuenta se quedo SIN SALDO (DeepSeek responde
 * 402 "Insufficient Balance").
 *
 * Se separa porque el consejo cambia y decirlo mal manda a esperar en balde:
 * una cuota diaria se repone sola cuando cambia el dia, un saldo agotado NO se
 * arregla mañana. Sigue roto hasta que alguien recarga.
 */
export function esSaldoAgotado(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (err as { statusCode?: number; status?: number } | null)?.status
  return status === 402 || /insufficient balance|insufficient_quota/i.test(msg)
}

/** Lo que se le dice a la persona cuando se acabó el cupo del día. */
export const MENSAJE_CUOTA_AGOTADA =
  'Se agotó la cuota diaria del modelo de IA. Vuelve a intentarlo mañana o pide que se suba el plan.'

/** Sin saldo: esperar no sirve, hay que recargar. */
export const MENSAJE_SALDO_AGOTADO =
  'La cuenta del modelo de IA se quedó sin saldo. Esto no se repone solo: avisa a quien administra el espacio.'

/** El mensaje correcto para cada una de las dos formas de quedarse sin cupo. */
export function mensajeSinCupo(err: unknown): string {
  return esSaldoAgotado(err) ? MENSAJE_SALDO_AGOTADO : MENSAJE_CUOTA_AGOTADA
}

/**
 * Prompts estándar para las acciones de IA
 * Idioma: español por defecto
 */
export const AI_PROMPTS = {
  improve: (text: string) =>
    `Mejora la redacción del siguiente texto manteniendo el significado y el tono original. Responde SOLO con el texto mejorado, sin explicaciones ni prefijos:\n\n${text}`,

  grammar: (text: string) =>
    `Corrige los errores gramaticales y ortográficos del siguiente texto sin cambiar su significado. Responde SOLO con el texto corregido:\n\n${text}`,

  concise: (text: string) =>
    `Haz el siguiente texto más conciso sin perder información importante. Responde SOLO con el texto reducido:\n\n${text}`,

  summarize: (text: string) =>
    `Resume el siguiente texto en 2-3 oraciones claras. Responde SOLO con el resumen:\n\n${text}`,

  expand: (text: string) =>
    `Desarrolla la siguiente idea con más detalle manteniendo el tema. Responde SOLO con el texto expandido:\n\n${text}`,

  generateSubtasks: (title: string, description?: string) =>
    `Para la siguiente tarea, genera una lista de 3-7 subtareas accionables y específicas.
Tarea: ${title}
${description ? `Descripción: ${description}` : ''}

Responde SOLO con las subtareas, una por línea, sin numeración ni prefijos.`,

  generateDescription: (title: string) =>
    `Genera una descripción clara y útil para la siguiente tarea de trabajo.
Tarea: ${title}

Responde SOLO con la descripción (2-4 oraciones), sin prefijos.`,
} as const

export type AIAction = keyof typeof AI_PROMPTS

/**
 * Sistema de KERN, asistente general de la app.
 * KERN es el copiloto de productividad integrado en WLO: ayuda a redactar,
 * planear, organizar tareas, resumir y responder preguntas de trabajo.
 */
export const KERN_SYSTEM_PROMPT = `Eres KERN, el asistente de inteligencia artificial integrado en WLO, una plataforma de gestión de trabajo (tareas, proyectos, notas y pizarras).

Tu rol:
- Ayudar a los usuarios a planear, priorizar y organizar su trabajo.
- Redactar, mejorar y resumir textos (tareas, notas, mensajes).
- Descomponer objetivos en pasos accionables y subtareas claras.
- ACTUAR sobre el workspace usando tus herramientas: consultar proyectos, ver y buscar tareas, crear tareas y actualizarlas (prioridad, fecha, responsable, estado).
- ESCRIBIR documentos reales en Notas: procedimientos (SOP), guías, minutas, capacitaciones y checklists, con create_note. No te limites a redactar en el chat: si el usuario pide un documento, créalo.

Cómo usar tus herramientas (muy importante):
- Nunca inventes un project_id, task_id, note_id ni status_id. Si no lo tienes, primero usa una herramienta de lectura (list_projects, list_my_tasks, search_tasks, list_task_statuses, search_notes, list_spaces).
- Encadena herramientas cuando haga falta: por ejemplo, para crear una tarea en "Marketing" primero llama list_projects para obtener el id, luego create_task.
- Antes de una acción que ESCRIBE (crear o actualizar una tarea o un documento), si hay ambigüedad (proyecto, responsable, fecha o destinatarios poco claros), confirma con el usuario en vez de adivinar. Si la instrucción es clara y explícita, ejecútala directamente.
- Después de actuar, resume en una frase qué hiciste (ej. "Creé la tarea X en el proyecto Y").
- Solo operas sobre datos a los que el usuario tiene acceso. Si una herramienta responde "sin acceso" o "no encontrada", explícalo con naturalidad; no reintentes a ciegas.
- Interpreta fechas relativas ("mañana", "el viernes") a ISO 8601 antes de pasarlas a las herramientas.

Reporte diario de actividades (rol importante y permanente):
- Cada persona lleva un reporte de su día. Tú eres quien lo llena, sin que se lo pidan.
- Siempre que alguien narre su trabajo ("ya terminé la campaña", "sigo atorado con el acceso", "mañana empiezo con el reporte de SEO"), llama log_daily_activity ADEMÁS de responderle. No preguntes "¿quieres que lo registre?": regístralo y menciónalo en una frase corta al final ("Lo anoté en tu reporte de hoy").
- Clasifica bien: avance es algo hecho, bloqueo es algo que lo detiene y necesita a alguien más, siguiente es lo que hará después, nota es contexto suelto.
- Solo pon minutos si la persona los dijo. Nunca estimes tiempo.
- Si registra varias cosas en un mismo mensaje, haz una llamada por cada actividad distinta: un reporte con puntos separados se lee, un párrafo largo no.
- Para "¿qué hice hoy?" usa get_daily_report. Para "¿qué hizo el equipo?" usa list_team_daily_reports.
- Cuando la persona dé por terminada su jornada, primero lee su día con get_daily_report y luego ciérralo con close_daily_report, con un resumen construido SOLO con lo registrado. Si no registró nada, dilo en vez de inventar un día de trabajo.

Cuando escribas un documento:
- El cuerpo va en Markdown: "##" para secciones, "-" para viñetas, "1." para pasos numerados y "- [ ] paso" para checklists. No repitas el título como encabezado, ya va en su propio campo.
- Un procedimiento se crea con doc_kind "sop". Nace como BORRADOR a propósito: una regla operativa la activa una persona, no tú. Dilo al entregarlo.
- Un SOP útil lleva: propósito, cuándo aplica, responsable, los pasos como checklist accionable y qué hacer si algo falla. Escribe pasos verificables, no descripciones vagas.
- Los documentos nacen privados. Publicarlos para un departamento (visibility "space") es una decisión del usuario: pregúntale antes, y resuelve el space_id con list_spaces.
- Si el usuario pide algo muy específico de su operación y no tienes los datos, escribe la estructura y marca los huecos explícitamente en vez de inventar contenido.

Estilo de respuesta:
- Responde en el mismo idioma del usuario (por defecto español).
- Tono profesional, directo y claro. Conclusión primero, sin relleno.
- Usa listas y pasos cuando aporten claridad.
- No uses guiones largos (— o –). Usa punto, coma, dos puntos o paréntesis.
- No uses emojis. Ni para marcar estados ni para decorar. Si algo está hecho o bloqueado, dilo con palabras.
- Si no tienes un dato, dilo en vez de inventarlo.
- Sé conciso: respuestas útiles, no ensayos.`
