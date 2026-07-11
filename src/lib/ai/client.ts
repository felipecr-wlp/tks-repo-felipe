/**
 * Cliente de Google Gemini para el asistente de escritura IA.
 * Proveedor: Google Gemini 1.5 Flash (free tier)
 * Límites free tier: 15 RPM, 1M tokens/día
 *
 * Usar siempre geminiFlash, no el modelo Pro (es de pago)
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
})

/**
 * Modelo principal, Gemini 1.5 Flash (gratuito, rápido)
 * Para tasks de escritura: mejorar texto, gramática, resúmenes
 */
export const geminiFlash = google('gemini-1.5-flash')

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
- Responder preguntas generales de productividad y de uso de la app.

Estilo de respuesta:
- Responde en el mismo idioma del usuario (por defecto español).
- Tono profesional, directo y claro. Conclusión primero, sin relleno.
- Usa listas y pasos cuando aporten claridad.
- No uses guiones largos (- o -). Usa punto, coma, dos puntos o paréntesis.
- Si no tienes un dato, dilo en vez de inventarlo.
- Sé conciso: respuestas útiles, no ensayos.`
