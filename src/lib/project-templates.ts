/**
 * Plantillas de proyecto (especialización We Love Paving: obra + marketing).
 *
 * Una plantilla NO es una tabla nueva: es una receta que, al crear el proyecto,
 * siembra (a) un flujo real de tareas en el primer status "por hacer" y (b) un
 * juego de campos personalizados (custom_field_definitions) listos para la obra.
 *
 * Se comparte entre el cliente (selector en el formulario) y el servidor
 * (POST /api/projects, que ejecuta la siembra). El servidor es la fuente de la
 * verdad: el cliente solo manda la clave `template`.
 */

export type TemplateFieldType =
  | 'text' | 'number' | 'currency' | 'date' | 'checkbox' | 'url' | 'select' | 'multi_select'

export interface TemplateFieldOption { id: string; label: string; color?: string }

export interface TemplateField {
  name: string
  field_type: TemplateFieldType
  options?: TemplateFieldOption[]
}

export interface TemplateTask {
  title: string
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none'
  description?: string
}

export interface ProjectTemplate {
  key: string
  label: string
  /** Texto corto para el selector. */
  blurb: string
  icon: string
  tasks: TemplateTask[]
  fields: TemplateField[]
}

/**
 * Obra de pavimentación: el flujo estándar de un job de WLP, desde la visita a
 * sitio hasta el cierre y la evaluación. Garantía 15 años asfalto / 5 años
 * concreto (regla del negocio).
 */
const PAVING_JOB: ProjectTemplate = {
  key: 'paving-job',
  label: 'Obra de pavimentación',
  blurb: 'Flujo completo de un job: visita, estimado, ejecución, cierre. Con campos de obra.',
  icon: 'building',
  tasks: [
    { title: 'Visita a sitio y medición', priority: 'high', description: 'Levantar dimensiones, condiciones del terreno y accesos. Tomar fotos.' },
    { title: 'Preparar estimado', priority: 'high', description: 'Calcular pies cuadrados, material, mano de obra y margen (~55%).' },
    { title: 'Enviar propuesta al cliente', priority: 'medium' },
    { title: 'Firmar contrato y anticipo', priority: 'medium', description: 'Confirmar alcance, garantía (15 años asfalto / 5 años concreto) y anticipo.' },
    { title: 'Agendar obra y permisos', priority: 'medium', description: 'Definir fecha de inicio, permisos municipales y logística de tráfico si aplica.' },
    { title: 'Movilizar equipo y material', priority: 'medium' },
    { title: 'Preparación de base / demolición', priority: 'medium', description: 'Remover superficie existente, nivelar y compactar la base.' },
    { title: 'Pavimentar (asfalto / concreto)', priority: 'high' },
    { title: 'Señalización y striping', priority: 'low', description: 'Marcado de líneas, cajones y señalética si el job lo incluye.' },
    { title: 'Punch list e inspección final', priority: 'medium', description: 'Recorrer con el cliente, corregir detalles y documentar la entrega.' },
    { title: 'Cierre, factura y evaluación', priority: 'medium', description: 'Facturar saldo, cerrar el job y capturar la evaluación del cliente.' },
  ],
  fields: [
    { name: 'Dirección del sitio', field_type: 'text' },
    {
      name: 'Tipo de superficie', field_type: 'select',
      options: [
        { id: 'asphalt', label: 'Asfalto', color: '#374151' },
        { id: 'concrete', label: 'Concreto', color: '#9ca3af' },
        { id: 'mixed', label: 'Mixto', color: '#f59e0b' },
      ],
    },
    { name: 'Pies cuadrados', field_type: 'number' },
    { name: 'Monto del contrato', field_type: 'currency' },
    {
      name: 'Garantía', field_type: 'select',
      options: [
        { id: 'asphalt-15', label: '15 años (asfalto)', color: '#22c55e' },
        { id: 'concrete-5', label: '5 años (concreto)', color: '#3b82f6' },
      ],
    },
    { name: 'Fecha de inicio programada', field_type: 'date' },
  ],
}

/**
 * Campaña de marketing: flujo estándar de una campaña pagada u orgánica, del
 * brief al reporte de resultados. Sirve a Google Ads, Meta, SEO, email, etc.
 */
const MARKETING_CAMPAIGN: ProjectTemplate = {
  key: 'marketing-campaign',
  label: 'Campaña de marketing',
  blurb: 'Del brief al reporte: creativos, copy, landing, tracking y optimización.',
  icon: 'rocket',
  tasks: [
    { title: 'Brief y objetivos de campaña', priority: 'high', description: 'Definir meta, oferta, público y presupuesto. Cerrar el alcance antes de producir.' },
    { title: 'Investigación de audiencia y competencia', priority: 'medium' },
    { title: 'Definir estrategia y mensajes', priority: 'high', description: 'Pilares de mensaje, ángulos y propuesta de valor por canal.' },
    { title: 'Producir creativos (imágenes / video)', priority: 'medium' },
    { title: 'Escribir copy y variantes', priority: 'medium', description: 'Titulares, cuerpo y CTAs. Validar límites de caracteres por plataforma.' },
    { title: 'Armar o ajustar landing', priority: 'medium' },
    { title: 'Configurar tracking (pixel / GA4 / conversiones)', priority: 'high', description: 'Verificar disparo de conversiones antes de lanzar. Sin tracking no se lanza.' },
    { title: 'Revisión y aprobación', priority: 'medium' },
    { title: 'Lanzar campaña', priority: 'high' },
    { title: 'Optimizar (primeras 2 semanas)', priority: 'medium', description: 'Pausar lo que no jala, escalar lo que convierte, vigilar fase de aprendizaje.' },
    { title: 'Reporte de resultados y aprendizajes', priority: 'medium' },
  ],
  fields: [
    {
      name: 'Canal', field_type: 'select',
      options: [
        { id: 'google-ads', label: 'Google Ads', color: '#4285f4' },
        { id: 'meta', label: 'Meta', color: '#0866ff' },
        { id: 'seo', label: 'SEO', color: '#22c55e' },
        { id: 'email', label: 'Email', color: '#f59e0b' },
        { id: 'tiktok', label: 'TikTok', color: '#111827' },
        { id: 'linkedin', label: 'LinkedIn', color: '#0a66c2' },
        { id: 'youtube', label: 'YouTube', color: '#ff0000' },
        { id: 'other', label: 'Otro', color: '#9ca3af' },
      ],
    },
    { name: 'Presupuesto', field_type: 'currency' },
    { name: 'Público objetivo', field_type: 'text' },
    { name: 'KPI objetivo', field_type: 'text' },
    { name: 'Fecha de lanzamiento', field_type: 'date' },
    {
      name: 'Estado de aprobación', field_type: 'select',
      options: [
        { id: 'draft', label: 'Borrador', color: '#9ca3af' },
        { id: 'review', label: 'En revisión', color: '#f59e0b' },
        { id: 'approved', label: 'Aprobado', color: '#22c55e' },
      ],
    },
  ],
}

/**
 * Contenido / SEO: flujo de una pieza de contenido, de la keyword a la medición.
 */
const CONTENT_SEO: ProjectTemplate = {
  key: 'content-seo',
  label: 'Contenido / SEO',
  blurb: 'De la keyword a la publicación: outline, redacción, on-page y medición.',
  icon: 'lightbulb',
  tasks: [
    { title: 'Definir tema y keyword objetivo', priority: 'high' },
    { title: 'Investigación de keywords e intención', priority: 'medium', description: 'Volumen, dificultad e intención de búsqueda. Evitar canibalización.' },
    { title: 'Esquema / outline', priority: 'medium' },
    { title: 'Redacción del borrador', priority: 'high' },
    { title: 'Edición y SEO on-page', priority: 'medium', description: 'Títulos, meta, encabezados, enlaces internos y schema si aplica.' },
    { title: 'Imágenes y multimedia', priority: 'low' },
    { title: 'Revisión y aprobación', priority: 'medium' },
    { title: 'Publicar', priority: 'medium' },
    { title: 'Indexar y promover', priority: 'low', description: 'Enviar a indexación, difundir en redes y email.' },
    { title: 'Medir y actualizar', priority: 'low' },
  ],
  fields: [
    { name: 'Keyword objetivo', field_type: 'text' },
    {
      name: 'Tipo de contenido', field_type: 'select',
      options: [
        { id: 'blog', label: 'Blog', color: '#3b82f6' },
        { id: 'landing', label: 'Landing', color: '#22c55e' },
        { id: 'case-study', label: 'Caso de éxito', color: '#f59e0b' },
        { id: 'video', label: 'Video', color: '#ef4444' },
        { id: 'social', label: 'Redes', color: '#a855f7' },
      ],
    },
    { name: 'Volumen de búsqueda', field_type: 'number' },
    { name: 'URL publicada', field_type: 'url' },
    { name: 'Fecha objetivo', field_type: 'date' },
    {
      name: 'Estado', field_type: 'select',
      options: [
        { id: 'draft', label: 'Borrador', color: '#9ca3af' },
        { id: 'review', label: 'En revisión', color: '#f59e0b' },
        { id: 'published', label: 'Publicado', color: '#22c55e' },
      ],
    },
  ],
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [PAVING_JOB, MARKETING_CAMPAIGN, CONTENT_SEO]

export function getProjectTemplate(key: string | null | undefined): ProjectTemplate | null {
  if (!key) return null
  return PROJECT_TEMPLATES.find(t => t.key === key) ?? null
}
