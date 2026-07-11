/**
 * Templates predefinidos para notas (wiki / SOP / docs).
 * El contenido es HTML compatible con Tiptap (StarterKit + extensions).
 *
 * `icon` es una CLAVE del registro lucide (ver src/lib/note-icons.tsx), no un
 * emoji: el render lo resuelve con <NoteIcon />.
 */

export interface NoteTemplate {
  id: string
  name: string
  icon: string
  description: string
  defaultTitle: string
  content: string
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    name: 'En blanco',
    icon: 'file',
    description: 'Empezar de cero',
    defaultTitle: 'Sin título',
    content: '',
  },
  {
    id: 'sop',
    name: 'SOP: Procedimiento',
    icon: 'clipboard',
    description: 'Procedimiento operativo estándar paso a paso',
    defaultTitle: 'SOP: [Nombre del proceso]',
    content: `
<h2>Objetivo</h2>
<p>Describir brevemente el propósito de este procedimiento y a quién aplica.</p>

<h2>Alcance</h2>
<p>Especificar a qué equipos, áreas o situaciones aplica este SOP.</p>

<h2>Responsables</h2>
<ul>
  <li><strong>Owner:</strong> [Nombre / Rol]</li>
  <li><strong>Ejecuta:</strong> [Nombre / Rol]</li>
  <li><strong>Revisa:</strong> [Nombre / Rol]</li>
</ul>

<h2>Pre-requisitos</h2>
<ul>
  <li>[Recurso, acceso o herramienta necesaria]</li>
  <li>[Otro pre-requisito]</li>
</ul>

<h2>Procedimiento</h2>
<ol>
  <li>Paso 1: describir la acción concreta.</li>
  <li>Paso 2: describir la acción concreta.</li>
  <li>Paso 3: describir la acción concreta.</li>
</ol>

<h2>Validación</h2>
<p>¿Cómo sabemos que el procedimiento se ejecutó correctamente?</p>

<h2>Notas y excepciones</h2>
<p>Casos especiales o consideraciones importantes.</p>
    `.trim(),
  },
  {
    id: 'meeting',
    name: 'Notas de reunión',
    icon: 'calendar',
    description: 'Plantilla para minutas de reunión',
    defaultTitle: 'Reunión: [Tema]',
    content: `
<h2>Datos</h2>
<ul>
  <li><strong>Fecha:</strong> </li>
  <li><strong>Asistentes:</strong> </li>
  <li><strong>Facilitador:</strong> </li>
</ul>

<h2>Agenda</h2>
<ol>
  <li>Tema 1</li>
  <li>Tema 2</li>
  <li>Tema 3</li>
</ol>

<h2>Notas</h2>
<p>Capturar los puntos discutidos por tema.</p>

<h2>Decisiones</h2>
<ul>
  <li>[Decisión + responsable]</li>
</ul>

<h2>Acción</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>[Tarea] · [responsable] · [fecha]</p></div></li>
</ul>
    `.trim(),
  },
  {
    id: 'brief',
    name: 'Project Brief',
    icon: 'target',
    description: 'Documento inicial de un proyecto',
    defaultTitle: 'Brief: [Nombre del proyecto]',
    content: `
<h2>Resumen</h2>
<p>Una descripción de 2-3 oraciones sobre qué es este proyecto y por qué importa.</p>

<h2>Objetivo</h2>
<p>¿Qué resultado concreto buscamos? ¿Cómo medimos el éxito?</p>

<h2>Audiencia / Stakeholders</h2>
<ul>
  <li>[Quién se beneficia o usa el resultado]</li>
  <li>[Quiénes son los stakeholders clave]</li>
</ul>

<h2>Entregables</h2>
<ul>
  <li>[Entregable 1]</li>
  <li>[Entregable 2]</li>
</ul>

<h2>Cronograma</h2>
<ul>
  <li><strong>Inicio:</strong> </li>
  <li><strong>Hitos:</strong> </li>
  <li><strong>Cierre:</strong> </li>
</ul>

<h2>Recursos</h2>
<ul>
  <li><strong>Equipo:</strong> </li>
  <li><strong>Presupuesto:</strong> </li>
  <li><strong>Herramientas:</strong> </li>
</ul>

<h2>Riesgos</h2>
<ul>
  <li>[Riesgo + mitigación]</li>
</ul>
    `.trim(),
  },
  {
    id: 'decision',
    name: 'Decision Log',
    icon: 'scale',
    description: 'Registro de una decisión importante',
    defaultTitle: 'Decisión: [Tema]',
    content: `
<h2>Contexto</h2>
<p>¿Qué situación estamos enfrentando? ¿Por qué necesitamos decidir?</p>

<h2>Opciones consideradas</h2>
<ol>
  <li><strong>Opción A:</strong> [descripción]
    <ul>
      <li>Pros: </li>
      <li>Contras: </li>
    </ul>
  </li>
  <li><strong>Opción B:</strong> [descripción]
    <ul>
      <li>Pros: </li>
      <li>Contras: </li>
    </ul>
  </li>
</ol>

<h2>Decisión</h2>
<p>Qué se decidió y por qué.</p>

<h2>Consecuencias</h2>
<ul>
  <li>Qué cambia a partir de esta decisión</li>
  <li>Qué seguimiento requiere</li>
</ul>

<h2>Quién decidió</h2>
<p>[Nombre + rol] · [Fecha]</p>
    `.trim(),
  },
  {
    id: 'wiki',
    name: 'Wiki / Documento',
    icon: 'books',
    description: 'Página estilo wiki con secciones',
    defaultTitle: '[Tema]',
    content: `
<h2>Introducción</h2>
<p>Resumen del tema.</p>

<h2>Detalles</h2>
<p>Explicación completa.</p>

<h3>Sub-tema 1</h3>
<p></p>

<h3>Sub-tema 2</h3>
<p></p>

<h2>Referencias</h2>
<ul>
  <li>[Enlaces, fuentes, documentos relacionados]</li>
</ul>
    `.trim(),
  },
]
