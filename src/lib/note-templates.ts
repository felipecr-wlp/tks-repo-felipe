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
  // Clasificacion como documento operativo. Si se define, la nota creada desde
  // esta plantilla aparece directamente en la lente "Procesos y SOPs".
  docKind?: 'sop' | 'sop_flow' | 'sop_index' | 'training'
  sopStatus?: 'draft' | 'review' | 'active' | 'obsolete'
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
    docKind: 'sop',
    sopStatus: 'draft',
    content: `
<div data-callout data-variant="info">
<p><strong>Ficha del SOP</strong></p>
<ul>
  <li><strong>Código:</strong> SOP-[ÁREA]-000</li>
  <li><strong>Versión:</strong> 1.0</li>
  <li><strong>Departamento:</strong> [Operaciones y Campo / Estimación y Ventas / Marketing / Seguridad / Finanzas / Legal / RH]</li>
  <li><strong>Dueño del proceso:</strong> [Nombre / Rol]</li>
  <li><strong>Ejecuta:</strong> [Nombre / Rol]</li>
  <li><strong>Revisa y aprueba:</strong> [Nombre / Rol]</li>
  <li><strong>Estatus:</strong> Borrador / En revisión / Activo / Obsoleto</li>
  <li><strong>Última revisión:</strong> [Fecha]</li>
  <li><strong>Próxima revisión:</strong> [Fecha]</li>
</ul>
</div>

<h2>Objetivo</h2>
<p>Qué logra este procedimiento y por qué existe.</p>

<h2>Alcance</h2>
<p>A qué equipos, áreas o situaciones aplica. Qué queda fuera.</p>

<h2>Disparador</h2>
<p>Qué evento inicia este proceso (ej. se gana un job, entra un lead, se agenda una obra).</p>

<h2>Pre-requisitos</h2>
<ul>
  <li>[Acceso, recurso o herramienta necesaria]</li>
  <li>[Otro pre-requisito]</li>
</ul>

<h2>Procedimiento paso a paso</h2>
<ol>
  <li><strong>[Rol]</strong>: Paso 1, acción concreta y resultado esperado.</li>
  <li><strong>[Rol]</strong>: Paso 2, acción concreta y resultado esperado.</li>
  <li><strong>[Rol]</strong>: Paso 3, acción concreta y resultado esperado.</li>
</ol>

<h2>Puntos de control</h2>
<p>Cómo sabemos que cada paso quedó bien. Qué se verifica antes de avanzar.</p>

<div data-callout data-variant="warn">
<p><strong>Seguridad y riesgos</strong></p>
<ul>
  <li>[Riesgo del proceso y cómo se mitiga]</li>
  <li>[PPE o precaución obligatoria]</li>
</ul>
</div>

<h2>Excepciones y escalamiento</h2>
<p>Qué hacer cuando algo se sale del flujo normal. A quién escalar.</p>

<h2>Registro de cambios</h2>
<ul>
  <li><strong>1.0</strong>: [Fecha], versión inicial. [Autor]</li>
</ul>
    `.trim(),
  },
  {
    id: 'sop-flow',
    name: 'SOP: Flujo de proceso',
    icon: 'tools',
    description: 'Mapa de un proceso con roles, handoffs y diagrama de pizarra',
    defaultTitle: 'Flujo: [Nombre del proceso]',
    docKind: 'sop_flow',
    sopStatus: 'draft',
    content: `
<div data-callout data-variant="info">
<p><strong>Ficha del proceso</strong></p>
<ul>
  <li><strong>Proceso:</strong> </li>
  <li><strong>Departamento:</strong> </li>
  <li><strong>Dueño:</strong> </li>
  <li><strong>Disparador:</strong> qué lo inicia</li>
  <li><strong>Resultado final:</strong> qué entrega cuando termina</li>
</ul>
</div>

<h2>Diagrama del flujo</h2>
<p>Inserta una pizarra con el comando <strong>/pizarra</strong> y dibuja el flujo (cajas, decisiones, flechas). El diagrama vive dentro de esta nota.</p>

<h2>Etapas y responsables</h2>
<p>Una fila por etapa: quién la hace, qué recibe y qué entrega al siguiente.</p>
<table>
<tbody>
  <tr><th>Etapa</th><th>Responsable</th><th>Entrada</th><th>Salida / handoff</th></tr>
  <tr><td>1. </td><td></td><td></td><td></td></tr>
  <tr><td>2. </td><td></td><td></td><td></td></tr>
  <tr><td>3. </td><td></td><td></td><td></td></tr>
</tbody>
</table>

<h2>Puntos de decisión</h2>
<ul>
  <li><strong>Si [condición]:</strong> [camino A]</li>
  <li><strong>Si no:</strong> [camino B]</li>
</ul>

<h2>Indicadores (KPIs)</h2>
<ul>
  <li>[Métrica del proceso: tiempo de ciclo, tasa de error, retrabajo]</li>
</ul>

<h2>SOPs relacionados</h2>
<ul>
  <li>[Enlazar el SOP de detalle de cada etapa]</li>
</ul>
    `.trim(),
  },
  {
    id: 'sop-index',
    name: 'Índice de SOPs (departamento)',
    icon: 'books',
    description: 'Portada de un departamento que lista sus SOPs y su estatus',
    defaultTitle: 'SOPs de [Departamento]',
    docKind: 'sop_index',
    sopStatus: 'active',
    content: `
<h2>SOPs de [Departamento]</h2>
<p>Portada del departamento. Aquí viven los procedimientos del área. Cada SOP es una sub-página de esta nota.</p>

<div data-callout data-variant="tip">
<p>Para crear un SOP nuevo: botón <strong>Sub-página</strong> arriba y elige la plantilla <strong>SOP: Procedimiento</strong> o <strong>SOP: Flujo de proceso</strong>.</p>
</div>

<h2>Directorio</h2>
<table>
<tbody>
  <tr><th>SOP</th><th>Dueño</th><th>Estatus</th><th>Última revisión</th></tr>
  <tr><td>[Nombre del SOP]</td><td></td><td>Activo</td><td></td></tr>
</tbody>
</table>

<h2>Pendientes de documentar</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>[Proceso que falta capturar]</p></div></li>
</ul>
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
  {
    id: 'training',
    name: 'Capacitación / Onboarding',
    icon: 'graduation',
    description: 'Guía de capacitación de un rol, proceso o herramienta',
    defaultTitle: 'Capacitación: [Rol o tema]',
    docKind: 'training',
    sopStatus: 'draft',
    content: `
<div data-callout data-variant="info">
<p><strong>Ficha</strong></p>
<ul>
  <li><strong>Rol o tema:</strong> </li>
  <li><strong>Departamento:</strong> </li>
  <li><strong>Responsable de la capacitación:</strong> </li>
  <li><strong>Duración estimada:</strong> </li>
</ul>
</div>

<h2>Objetivo de la capacitación</h2>
<p>Qué debe saber o poder hacer la persona al terminar.</p>

<h2>Ruta de aprendizaje</h2>
<ol>
  <li>[Módulo 1: tema y SOP relacionado]</li>
  <li>[Módulo 2: tema y SOP relacionado]</li>
</ol>

<h2>Recursos</h2>
<ul>
  <li>[SOPs, videos, documentos, accesos]</li>
</ul>

<h2>Checklist de dominio</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>[Habilidad o tarea que debe demostrar]</p></div></li>
</ul>

<h2>Evaluación</h2>
<p>Cómo se confirma que quedó capacitado. Quién lo valida.</p>
    `.trim(),
  },
  {
    id: 'wlp-estimate',
    name: 'WLP: Estimación de obra',
    icon: 'target',
    description: 'Bid de pavimento (asfalto/concreto) con alcance, materiales y margen',
    defaultTitle: 'Estimación: [Cliente] · [Sitio]',
    content: `
<h2>Datos del cliente y sitio</h2>
<ul>
  <li><strong>Cliente:</strong> </li>
  <li><strong>Contacto:</strong> </li>
  <li><strong>Dirección del sitio:</strong> </li>
  <li><strong>Tipo:</strong> Residencial / Comercial</li>
</ul>

<h2>Alcance de la obra</h2>
<ul>
  <li><strong>Servicio:</strong> Asfalto / Concreto / Sealcoating / Striping</li>
  <li><strong>Superficie (sq ft):</strong> </li>
  <li><strong>Espesor / especificación:</strong> </li>
  <li><strong>Preparación de base:</strong> </li>
</ul>

<h2>Materiales y tonelaje</h2>
<ul>
  <li><strong>Toneladas de asfalto / yardas de concreto:</strong> </li>
  <li><strong>Proveedor / planta:</strong> </li>
</ul>

<h2>Precio y margen</h2>
<ul>
  <li><strong>Precio de venta:</strong> </li>
  <li><strong>Costo estimado:</strong> </li>
  <li><strong>Margen bruto objetivo:</strong> ~55% (referencia SSOT Finanzas)</li>
</ul>

<h2>Garantía</h2>
<p>Asfalto: 15 años. Concreto: 5 años. (Ver SSOT Legal &amp; Contracts para términos exactos.)</p>

<h2>Notas y condiciones</h2>
<p>Acceso, clima, permisos, exclusiones.</p>
    `.trim(),
  },
  {
    id: 'wlp-job-kickoff',
    name: 'WLP: Arranque de obra',
    icon: 'clipboard',
    description: 'Checklist de campo para iniciar un job de pavimento',
    defaultTitle: 'Arranque: [Obra / Job #]',
    content: `
<h2>Identificación</h2>
<ul>
  <li><strong>Obra / Job #:</strong> </li>
  <li><strong>Cliente:</strong> </li>
  <li><strong>Fecha programada:</strong> </li>
  <li><strong>Supervisor de campo:</strong> </li>
</ul>

<h2>Cuadrilla y equipo</h2>
<ul>
  <li><strong>Cuadrilla asignada:</strong> </li>
  <li><strong>Equipo (pavimentadora, rodillo, camiones):</strong> </li>
</ul>

<h2>Materiales</h2>
<ul>
  <li><strong>Toneladas / yardas:</strong> </li>
  <li><strong>Hora de entrega en planta:</strong> </li>
</ul>

<h2>Acceso y logística del sitio</h2>
<ul>
  <li>Punto de entrada, restricciones de horario, tráfico.</li>
</ul>

<h2>Checklist de arranque</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Confirmar entrega de material</p></div></li>
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Verificar equipo y combustible</p></div></li>
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Charla de seguridad con la cuadrilla</p></div></li>
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Sitio despejado y delimitado</p></div></li>
</ul>
    `.trim(),
  },
  {
    id: 'wlp-safety-talk',
    name: 'WLP: Charla de seguridad',
    icon: 'flame',
    description: 'Toolbox talk de seguridad para la cuadrilla antes de la obra',
    defaultTitle: 'Seguridad: [Fecha] · [Obra]',
    content: `
<h2>Datos</h2>
<ul>
  <li><strong>Fecha:</strong> </li>
  <li><strong>Obra / Ubicación:</strong> </li>
  <li><strong>Facilitador:</strong> </li>
  <li><strong>Tema del día:</strong> </li>
</ul>

<h2>Peligros identificados</h2>
<ul>
  <li>Calor y asfalto caliente</li>
  <li>Tráfico y maquinaria en movimiento</li>
  <li>[Otro peligro del sitio]</li>
</ul>

<h2>Equipo de protección (PPE)</h2>
<ul>
  <li>Chaleco reflectante, botas, guantes, protección visual y auditiva.</li>
</ul>

<h2>Puntos discutidos</h2>
<p>Resumir lo hablado con la cuadrilla.</p>

<h2>Asistencia</h2>
<p>Listar los asistentes. Cada quien confirma haber recibido la charla.</p>
    `.trim(),
  },
  {
    id: 'wlp-closeout',
    name: 'WLP: Cierre de obra',
    icon: 'chart',
    description: 'Cierre y revisión post-obra: estimado vs real, punch list, firma',
    defaultTitle: 'Cierre: [Obra / Job #]',
    content: `
<h2>Resumen de la obra</h2>
<ul>
  <li><strong>Obra / Job #:</strong> </li>
  <li><strong>Fecha de cierre:</strong> </li>
</ul>

<h2>Estimado vs real</h2>
<ul>
  <li><strong>Toneladas estimadas vs usadas:</strong> </li>
  <li><strong>Horas de cuadrilla estimadas vs reales:</strong> </li>
  <li><strong>Margen bruto real:</strong> </li>
</ul>

<h2>Calidad y pendientes (punch list)</h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>[Pendiente de corrección]</p></div></li>
</ul>

<h2>Firma del cliente</h2>
<p>Cliente conforme con el trabajo. [Nombre + fecha]</p>

<h2>Lecciones aprendidas</h2>
<p>Qué salió bien, qué mejorar para la próxima.</p>
    `.trim(),
  },
]
