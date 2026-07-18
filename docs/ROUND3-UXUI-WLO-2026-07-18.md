# WLO Ronda 3: Sprint R2-A + auditoría y correcciones UX/UI
**Fecha: 2026-07-18 · Continuación de ROUND2-WLO-2026-07-18.md · Validado: tsc exit 0, next lint exit 0**

**Estado de deploy: NADA de esta ronda está en producción.** No corrí ningún deploy desde este entorno (no puedo verificarlo con `vercel inspect`). Todo queda listo para revisión y viaja en el mismo redeploy pendiente de las rondas 1 y 2.

---

## 1. Sprint R2-A implementado (velocidad percibida)

| Item | Qué se hizo | Archivo |
|------|-------------|---------|
| T1 | Debounce del filtrado de búsqueda del Kanban via `useDeferredValue`: el input responde al instante en cada tecla y React difiere el recálculo de tarjetas sin bloquear el tecleo | `src/components/tasks/KanbanBoard.tsx` (imports + bloque de filtros) |
| T2 | Optimistic updates en la fila de lista: cambiar estado, prioridad, asignado o título se refleja al instante (patrón Linear/ClickUp), con revert + toast si el servidor rechaza. Se eliminó el bloqueo visual (`opacity-60` + `pointer-events-none`) durante el fetch de edición | `src/components/tasks/TaskRow.tsx` (updateTask reescrito) |
| T4 | Rollback correcto de drag&drop: al fallar el PATCH se revierte SOLO la tarea movida a su status/sort_order previos. Antes se restauraba `initialTasks` completo, pisando cambios locales posteriores | `src/components/tasks/KanbanBoard.tsx` (handleDragEnd) |
| S3 | FloatingChat ya no traga errores con `.catch(() => {})`: muestra estado de error con icono y botón "Reintentar" en vez de "Cargando..." infinito | `src/components/chat/FloatingChat.tsx` |
| T5 | Ya estaba resuelto en el código actual: el chat del proyecto solo se consulta con `view=chat` y las subtareas tienen early return. Lo que sí faltaba y se corrigió: las reacciones ahora se acotan a los mensajes cargados con `.in('message_id', ...)` (antes traía TODAS las del proyecto, creciendo sin límite con el historial) | `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx` |

---

## 2. Auditoría UX/UI de las 8 vistas: hallazgos

Dos pasadas de auditoría (vistas de tareas + Scrum/Notas/Inbox/Chat), verificando cada cita antes de corregir. Nota: dos hallazgos de los agentes resultaron falsos al verificar (la ruta del proyecto SÍ tiene `loading.tsx`, y el estado vacío del inbox sí existía; solo le faltaba CTA).

### Corregidos en esta ronda (U1-U12)

| # | Hallazgo | Archivo | Fix aplicado |
|---|----------|---------|--------------|
| U1 | Menús de estado/prioridad/asignado en la fila solo cerraban con `onMouseLeave`: inutilizables con teclado y touch | `TaskRow.tsx` (StatusMenu, PriorityMenu, AssignMenu) | Hook `useEscapeToClose` + overlay click-outside en los 3 menús |
| U2 | Items de esos menús sin estado de foco visible | `TaskRow.tsx` | `focus-visible:bg-accent focus-visible:outline-none` en los 4 tipos de item |
| U3 | FloatMenu de acciones masivas sin cierre con Escape | `BulkActionBar.tsx` | Listener de Escape (el overlay click-outside ya existía) |
| U4 | Picker de reacciones del chat sin cierre con Escape | `ProjectChat.tsx` | Effect que cierra con Escape mientras el picker está abierto |
| U5 | Menú contextual de notas sin cierre con Escape (solo click fuera) | `NotesTreeSidebar.tsx` (effect de cierre) | Listener `keydown` Escape agregado al mismo effect |
| U6 | Botón "Enviar" del chat sin indicador de envío en curso (solo `disabled`) | `TeamChat.tsx` (composer) | Spinner `Loader2` + `aria-label` |
| U7 | "Marcar todo como leído" sin indicador mientras procesa | `inbox/InboxList.tsx` | Spinner `Loader2` durante `marking` |
| U8 | Bandeja vacía sin CTA: solo texto descriptivo | `inbox/InboxList.tsx` | Link "Ver mis tareas" hacia `/my-tasks` |
| U9 | Doble submit posible en crear tarea inline con Enter repetido | `CreateTaskInline.tsx` (handleCreate) | Guard `if (isLoading) return` |
| U10 | Estado vacío del calendario: una línea de texto plano, inconsistente con el patrón de la casa (icono + título + guía) | `TaskCalendarView.tsx` | Estado vacío con icono `CalendarDays`, título y guía, mismo patrón que Inbox |
| U11 | Ruta `/t/[teamSlug]/chat` era la única vista sin `loading.tsx`: carga fría en blanco | `chat/loading.tsx` (NUEVO) | Skeleton de header + burbujas + composer, patrón de `inbox/loading.tsx` |
| U12 | Botones de solo icono sin `aria-label` (dependían solo de `title`) | `TaskRow.tsx` (eliminar), `FloatingChat.tsx` (maximizar, cerrar) | `aria-label` agregado |

---

## 3. Pendientes de UX/UI (verificados pero fuera de esta ronda)

En orden de recomendación. Esfuerzo: QW horas, M días.

| # | Pendiente | Archivo:línea | Esfuerzo |
|---|-----------|---------------|----------|
| P1 | Reemplazar `confirm()` nativo por AlertDialog propio (4 sitios): rompe la estética y no respeta dark mode | `TaskRow.tsx:155`, `TaskDetailPanel.tsx:270`, `BulkActionBar.tsx:84`, `ManageCustomFieldsModal.tsx:126` | M |
| P2 | Selector de sprint desaparece cuando no hay sprints, sin placeholder ni CTA "Crear sprint" | `ScrumWorkspace.tsx` (~501-513) | QW |
| P3 | Menú desplegable de asignados con solo `onMouseLeave` (mismo patrón que U1, quedó fuera del lote) | `AssigneesSection.tsx:111` | QW |
| P4 | aria-labels en filtros de Scrum (persona, proyecto, vencidas) | `ScrumWorkspace.tsx` (~1147) | QW |
| P5 | Columna Kanban `w-[82vw]` en viewports muy chicos: evaluar snap-scroll con hints | `KanbanBoard.tsx` (~269) | M |
| P6 | Transición suave al cambiar de vista (Lista/Tablero/Calendario): hoy el cambio es abrupto | página del proyecto | QW |
| P7 | ⚠️ Dashboard Scrum: diferenciar visualmente "sin datos" (Empty) de "cargando" en las gráficas | `ScrumWorkspace.tsx` (~1508-1537) | M |

Decisión documentada: los emojis del picker de reacciones (`ProjectChat.tsx:21`) se QUEDAN como emojis. Son contenido de usuario (la reacción que se guarda y se muestra), no iconografía de la UI; reemplazarlos por iconos lucide rompería la semántica del whitelist del endpoint.

---

## 4. Validación y deploy

- `npm run type-check` (tsc --noEmit): exit 0 DESPUÉS de todos los cambios.
- `npm run lint` (next lint): exit 0, sin warnings.
- `next build` no corre en este entorno (timeout del sandbox); Vercel lo validará en el deploy.
- **No deployado.** Acciones manuales pendientes (mismas 4 de la ronda 1): borrar `.git\index.lock`, commit + push, configurar `CRON_SECRET` en Vercel, `npx vercel --prod`.

Archivos tocados en esta ronda: 10 modificados + 1 nuevo (`chat/loading.tsx`).

---

## 5. Ronda 3.1: P1-P4 resueltos (accesibilidad y consistencia)

Validado: `tsc --noEmit` exit 0, `next lint` exit 0. No deployado, viaja en el mismo redeploy pendiente.

**Corrección de alcance de P1:** el doc contaba 4 `confirm()` nativos (solo el area de tareas); el repo tenia **11**. Arreglar 4 y deployar 7 modales nativos era incoherente con el objetivo de base limpia, asi que se migraron los 11.

| # | Resuelto | Detalle |
|---|----------|---------|
| P1 | `confirm()` nativo eliminado (11 sitios, no 4) | Nuevo `src/components/ConfirmDialog.tsx`: API global `confirmDialog()` estilo sonner (promesa) + `<ConfirmDialogHost />` montado una vez en `app/layout.tsx` junto al `<Toaster />`. `role="alertdialog"`, `aria-modal`, Escape y click-outside cancelan, autofocus en Cancelar cuando es destructivo, variante `destructive` (boton rojo con tokens `bg-destructive`). Sitios migrados: `TaskRow`, `TaskDetailPanel`, `BulkActionBar`, `ManageCustomFieldsModal`, `GoalsView`, `NotesTreeSidebar`, `WhiteboardEditor`, `NoteVersions`, `NoteEditor`, `TrackingClient`, `InvitesPanel`. Todos sus handlers ya eran `async`. De paso se corrigieron tildes/ñ en los mensajes visibles. |
| P2 | Estado vacio del selector de sprint | `ScrumWorkspace.tsx` (SprintBar): cuando `sprints.length === 0` aparece un CTA "+ Crear el primer sprint" que dispara `setShowNew(true)` (mismo flujo del boton "+ Sprint"), en vez de que el control desaparezca sin rastro. |
| P3 | Dropdown de asignados accesible | `AssigneesSection.tsx`: se agrego efecto de Escape + overlay `fixed inset-0` para click-outside, conservando `onMouseLeave`. Mismo patron que U1 (el que "quedo fuera del lote"). |
| P4 | aria de los filtros de Scrum | `ScrumWorkspace.tsx`: `aria-label` + `aria-pressed` en los 4 toggles de filtro (persona, proyecto, vencidas, sin asignar) para exponer el estado a lectores de pantalla. |

Pendientes que siguen abiertos: **P5** (snap-scroll de columnas Kanban en viewports chicos), **P6** (transicion suave al cambiar de vista), **P7** (Dashboard Scrum: diferenciar Empty de loading en las graficas).

Archivos de la 3.1: 12 modificados + 1 nuevo (`components/ConfirmDialog.tsx`).

---

## 6. Ronda 3.2: P5-P7 resueltos (ultimos pendientes UX/UI)

Validado: `tsc --noEmit` exit 0, `next lint` exit 0 (sin warnings). No deployado, viaja en el mismo redeploy pendiente. Con esto queda cerrado el capitulo de consistencia UX/UI (P1-P7); lo que sigue es Sprint R2-B (features nuevas), no limpieza.

| # | Resuelto | Detalle |
|---|----------|---------|
| P5 | Alineacion de snap-scroll del Kanban | `KanbanBoard.tsx`: el contenedor ya tenia `snap-x snap-mandatory sm:snap-none` y las columnas `snap-start`; el "hint" en viewport chico ya lo da la propia columna `w-[82vw]` que deja asomar (~18vw) la siguiente (patron carrusel movil estandar). Lo que faltaba era la alineacion: se agrego `scroll-px-3 sm:scroll-px-6` para que la columna a la que hace snap quede alineada con el padding del contenedor y no pegada al borde. Conclusion de la evaluacion pedida: no se agrega indicador de puntos (over-engineering con numero de columnas variable); el peek + snap ya cumplen. |
| P6 | Transicion suave al cambiar de vista | `p/[projectSlug]/page.tsx`: el switch Lista/Tablero/Calendario/Workload/Chat son **links** (`?view=...`, navegacion server-side), por eso el cambio se veia abrupto. Se agrego `key={currentView}` + `animate-in fade-in duration-200` al contenedor de la vista, asi cada vista hace un fundido de entrada al montar. Usa el mismo `tailwindcss-animate` que ya usa CommandPalette/SlashMenu. Sin rearquitectar a estado cliente. |
| P7 | Estado vacio de graficas del Dashboard Scrum | **Hallazgo:** el componente es SSR puro (`tasks` llega por prop -> `localTasks`, sin fetch cliente); NO existe estado "cargando" dentro del componente (la carga fria la cubre el `loading.tsx` de la ruta). Por eso "diferenciar loading de Empty" no aplica literal: un vacio aqui SIEMPRE es "no hay datos", nunca "todavia cargando". El defecto real era que el `<Empty />` generico ("Sin datos para graficar") se leia como "roto". Fix: `Empty` ahora acepta `hint` y cada una de las 5 graficas (2 del panel de sprint, 3 del panel de flujo/Kanban) explica POR QUE esta vacia (sin tareas en el sprint, sin tareas del equipo, sin area asignada). Vacio autoexplicativo en vez de ambiguo. |

Archivos de la 3.2: 3 modificados (`KanbanBoard.tsx`, `ScrumWorkspace.tsx`, `p/[projectSlug]/page.tsx`).

**Estado UX/UI: P1-P7 cerrados.** Siguiente frente = Sprint R2-B (atajo global `C`, asignar desde tarjeta, carry-over de sprint), que es alcance de features, no de pulido.

---

## 7. Deploy ejecutado (rondas 1-3 EN PRODUCCION)

**Actualiza el banner de arriba: ya NO es cierto que "nada esta en produccion".** El 2026-07-18 se ejecuto el redeploy pendiente.

- **Commit:** `8449acd` "fix: ronda 3 UX/UI (R2-A velocidad + accesibilidad U1-U12 + P1-P7)", 25 archivos (+507/-54). Pusheado a `origin/master` (`57fe896..8449acd`) en `github.com/PAVIFIC/tskr`. Rondas 1-2 ya estaban commiteadas/pusheadas antes (57fe896, 029fd5d); este deploy las arrastra.
- **Deploy Vercel:** proyecto `wlo` (org `developers-pavific`, `prj_3Gw2gm9VaxhiVgTI0sOSotp7Vqb8`). `vercel --prod` -> `readyState: READY`, `target: production`, id `dpl_aeZA5WDMFsW5viar3sYJoSA3Ng43`. Aliased a **`https://wlo.vercel.app`**. La build corrio y paso en Vercel (no se corre en este entorno por timeout del sandbox).
- **CRON_SECRET:** hallazgo, ya estaba configurado en Production (creado 1h antes del deploy), junto con el resto de env vars (Supabase URL/anon/service_role, Google OAuth id/secret, Gemini, ALLOWED_EMAIL_DOMAINS, NEXT_PUBLIC_APP_URL). El pendiente manual del doc estaba stale.
- **Pendiente de verificacion:** smoke test en navegador de `wlo.vercel.app` (login + una vista de tareas + una confirmacion destructiva para ver el ConfirmDialog nuevo). No se pudo hacer por API desde el entorno (egress HTTPS del sandbox devuelve error SSL).

---

*Historial: seguridad y bloqueantes en `docs/AUDIT-WLO-2026-07-18.md` (ronda 1); realtime filtrado y fail-fast en `docs/ROUND2-WLO-2026-07-18.md` (ronda 2).*
