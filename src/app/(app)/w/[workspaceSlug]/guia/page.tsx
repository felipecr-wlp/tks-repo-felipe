/**
 * /w/[slug]/guia, curso e instrucciones de uso de WLO.
 *
 * Manual de una sola pagina, escaneable: hero + indice + secciones tematicas
 * con pasos, atajos y enlaces directos a cada area del workspace. Server
 * Component estatico (sin datos): solo usa el slug para construir los enlaces.
 */
import Link from 'next/link'
import {
  GraduationCap,
  Compass,
  LayoutGrid,
  ListChecks,
  FileText,
  PenTool,
  Target,
  MessageSquare,
  Keyboard,
  ShieldCheck,
  UsersRound,
  FolderKanban,
  CalendarDays,
  Timer,
  ArrowRight,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react'

export const metadata = { title: 'Guía de uso · WLO' }

interface GuiaPageProps {
  params: { workspaceSlug: string }
}

interface Section {
  id: string
  icon: LucideIcon
  title: string
  intro: string
  steps?: string[]
  tip?: string
  cta?: { label: string; href: string }
}

export default function GuiaPage({ params }: GuiaPageProps) {
  const base = `/w/${params.workspaceSlug}`

  const sections: Section[] = [
    {
      id: 'conceptos',
      icon: Compass,
      title: '1. Los conceptos base',
      intro:
        'WLO se organiza en cuatro capas. Entenderlas hace que todo lo demás encaje.',
      steps: [
        'Workspace: tu empresa dentro de WLO. Todo vive aquí.',
        'Equipos: agrupan el trabajo por área (Marketing, Operaciones, Ventas).',
        'Proyectos: dentro de cada equipo, con su propio tablero de tareas.',
        'Departamentos: espacios de conocimiento (Notas y SOPs) transversales.',
      ],
      tip: 'Un equipo puede tener varios proyectos; un proyecto siempre pertenece a un equipo.',
    },
    {
      id: 'tareas',
      icon: LayoutGrid,
      title: '2. Crear y mover tareas',
      intro:
        'Las tareas son la unidad de trabajo. Puedes crearlas de tres formas.',
      steps: [
        'Botón "Nueva tarea" del menú lateral, o la tecla C desde cualquier pantalla.',
        'El botón "+ Nueva tarea" al pie de cada columna del tablero (creación rápida).',
        'Arrastra una tarjeta entre columnas (Por hacer, En progreso, En revisión) para cambiar su estado.',
        'Asigna prioridad con las pastillas de color: Baja, Media, Alta o Urgente.',
      ],
      tip: 'Al crear una tarea recuerda elegir el proyecto correcto: define en qué tablero aparece.',
      cta: { label: 'Ir al inicio del workspace', href: base },
    },
    {
      id: 'vistas',
      icon: ListChecks,
      title: '3. Las vistas del proyecto',
      intro:
        'Cada proyecto se puede ver de varias maneras según lo que necesites.',
      steps: [
        'Lista: todas las tareas en filas, ideal para revisar y filtrar.',
        'Tablero: columnas por estado, arrastra y suelta (Kanban / Scrum).',
        'Calendario: tareas ubicadas por su fecha de vencimiento.',
        'Carga: cuánta chamba tiene asignada cada persona.',
        'Chat: conversación del equipo dueño del proyecto.',
      ],
    },
    {
      id: 'detalle',
      icon: FolderKanban,
      title: '4. El panel de una tarea',
      intro:
        'Al abrir una tarea se despliega el panel de la derecha con todo su detalle.',
      steps: [
        'Asignados, seguidores, fechas de inicio y vencimiento, estimación y prioridad.',
        'Subtareas y lista de verificación para desglosar el trabajo.',
        'Dependencias y relaciones con otras tareas.',
        'Tiempo: inicia un cronómetro o registra minutos manualmente.',
        'Adjuntos (hasta 25MB) y comentarios con menciones @ para notificar.',
      ],
      tip: 'Escribe @nombre en la descripción o los comentarios para avisar a un compañero.',
    },
    {
      id: 'notas',
      icon: FileText,
      title: '5. Notas, SOPs y departamentos',
      intro:
        'La base de conocimiento estilo Confluence: procesos, manuales y documentación.',
      steps: [
        'Crea notas dentro de un departamento (Operaciones, Finanzas, Legal, etc.).',
        'Usa plantillas listas (estimación WLP, kickoff, plática de seguridad, cierre).',
        'Marca una nota como SOP con su estatus, versión y fecha de revisión.',
        'Los espacios restringidos (Finanzas, Legal, RH) solo los ve quien tiene permiso.',
      ],
      cta: { label: 'Abrir Notas', href: `${base}/notes` },
    },
    {
      id: 'pizarras',
      icon: PenTool,
      title: '6. Pizarras',
      intro:
        'Lienzos visuales para ideas, flujos y diagramas, solos o incrustados en una nota.',
      steps: [
        'Crea una pizarra desde la sección Pizarras.',
        'Insértala dentro de una nota con el comando /pizarra del editor.',
        'La edición es colaborativa y se guarda sola.',
      ],
      cta: { label: 'Abrir Pizarras', href: `${base}/whiteboards` },
    },
    {
      id: 'metas',
      icon: Target,
      title: '7. Metas y Tracking',
      intro:
        'Fija objetivos y da seguimiento al tiempo dedicado al trabajo.',
      steps: [
        'Metas: define objetivos del workspace y avanza su progreso.',
        'Tracking: consulta el tiempo registrado por tarea y persona.',
      ],
      cta: { label: 'Abrir Metas', href: `${base}/goals` },
    },
    {
      id: 'chat',
      icon: MessageSquare,
      title: '8. Chat de equipo',
      intro:
        'Conversa con tu equipo sin salir de WLO, desde la burbuja azul flotante.',
      steps: [
        'La burbuja abajo a la derecha abre el chat del equipo activo.',
        'Cambia de equipo con el selector superior del panel.',
        'El punto rojo indica mensajes sin leer cuando el panel está cerrado.',
        'El botón de pantalla completa lleva al chat del equipo en su página.',
      ],
    },
    {
      id: 'roles',
      icon: ShieldCheck,
      title: '9. Roles y permisos',
      intro:
        'Lo que puedes ver y hacer depende de tu rol en la organización y el workspace.',
      steps: [
        'Owner y Admin: gestionan miembros, equipos, departamentos e invitaciones.',
        'Manager y Member: trabajan en sus equipos y proyectos.',
        'Viewer: acceso de solo lectura.',
      ],
      cta: { label: 'Abrir Configuración', href: `${base}/settings` },
    },
  ]

  const shortcuts: Array<{ keys: string; action: string }> = [
    { keys: 'C', action: 'Crear una tarea nueva' },
    { keys: 'Enter', action: 'Confirmar creación / enviar' },
    { keys: 'Esc', action: 'Cerrar el panel o cancelar' },
    { keys: 'Ctrl + Enter', action: 'Enviar un comentario' },
  ]

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-muted/30 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-soft">
            <GraduationCap size={26} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Guía de uso de WLO</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Un recorrido corto por todo lo que puedes hacer: crear tareas, armar
              flujos de trabajo, documentar procesos y colaborar con tu equipo. Léela
              de corrido o salta a la sección que necesites.
            </p>
          </div>
        </div>
      </div>

      {/* Indice */}
      <nav aria-label="Índice de la guía" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <s.icon size={15} className="flex-shrink-0 text-primary" />
            <span className="truncate">{s.title}</span>
          </a>
        ))}
      </nav>

      {/* Secciones */}
      <div className="mt-8 space-y-5">
        {sections.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className="scroll-mt-20 rounded-2xl border border-border bg-card p-5 sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <s.icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground">{s.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{s.intro}</p>

                {s.steps && (
                  <ul className="mt-3 space-y-2">
                    {s.steps.map((step, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-foreground">
                        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="text-muted-foreground">{step}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {s.tip && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Lightbulb size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{s.tip}</span>
                  </div>
                )}

                {s.cta && (
                  <Link
                    href={s.cta.href}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {s.cta.label}
                    <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            </div>
          </section>
        ))}

        {/* Atajos de teclado */}
        <section id="atajos" className="scroll-mt-20 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Keyboard size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground">10. Atajos de teclado</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Para moverte más rápido sin soltar el teclado.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {shortcuts.map((sc) => (
                  <div
                    key={sc.keys}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2"
                  >
                    <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                      {sc.keys}
                    </kbd>
                    <span className="text-sm text-muted-foreground">{sc.action}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Accesos rápidos al final */}
      <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-foreground">Accesos rápidos</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { icon: UsersRound, label: 'Equipos', href: `${base}/teams/new` },
            { icon: CalendarDays, label: 'Calendario', href: `${base}/calendar` },
            { icon: Timer, label: 'Tracking', href: `${base}/tracking` },
            { icon: Compass, label: 'Oportunidades', href: `${base}/projects` },
          ].map((q) => (
            <Link
              key={q.label}
              href={q.href}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <q.icon size={15} className="flex-shrink-0 text-primary" />
              {q.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
