/**
 * Cliente de Google Gemini para el asistente de escritura IA.
 * Proveedor: Google Gemini 2.5 Flash (free tier)
 * Nota: gemini-1.5-flash fue retirado por Google (404 en v1beta desde 2026).
 * El modelo puede sobreescribirse con la variable de entorno GEMINI_MODEL
 * sin necesidad de redeploy de código.
 *
 * Usar siempre geminiFlash, no el modelo Pro (es de pago)
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
})

/**
 * Modelo principal, Gemini 2.5 Flash (free tier, rápido)
 * Para tasks de escritura: mejorar texto, gramática, resúmenes
 */
export const geminiFlash = google(process.env.GEMINI_MODEL ?? 'gemini-2.5-flash')

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
- Si no tienes un dato, dilo en vez de inventarlo.
- Sé conciso: respuestas útiles, no ensayos.`
