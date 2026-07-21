# WLO/TSKR, plan V2: chat con superpoderes y pulido "no v1"

Guía viva de mejoras para llevar WLO de "funciona" a "se siente pro". Complementa
`docs/ROADMAP-CLICKUP-PARITY.md` (tracks A/B/C): aquel cierra paridad de features;
este se enfoca en lo que Ali pidió ahora (chat que adjunta tareas, archivos,
recordatorios y automatizaciones) y en el pulido que quita la sensación de v1.

Reglas heredadas del proyecto: sin guiones largos, iconos lucide (no emojis),
texto visible en español con ñ y tildes, acento azul #2563EB. Cambios SIEMPRE
aditivos: nunca romper Scrum, Marketplace, Chat, Notas ni Pizarra. Cada circuito
deja `npx tsc --noEmit` y `npx next build` en EXIT 0, hace deploy prod
(`npx vercel deploy --prod --yes --token <tok>` desde la carpeta TSKR) y agrega
entrada al `COLAB-CHANGELOG.md`. Migraciones aditivas y con default; respetar los
landmines (sin ciclos de FK, sin RLS con subquery a su propia tabla, sin 2a FK
ambigua a profiles sin hint).

---

## Estado actual honesto (julio 2026)

Ya sólido: tareas con estados custom, prioridad, multi-asignado, subtareas,
dependencias, relaciones, checklist, tiempo, adjuntos (bucket privado
`task-files` con signed URL), comentarios con @menciones. Vistas Lista, Tablero
(drag and drop), Calendario, Carga. Notas/Wiki tipo Confluence con SOPs, acuses,
plantillas y pizarras. Metas, Tracking, roles y permisos, invitaciones,
onboarding, y ahora la Guía de uso (`/guia`). Inbox y notificaciones in-app
existen (`api/notifications`, `inbox/`). Crons: `due-reminders`, `sop-reviews`.

Chat: de equipo y de proyecto por Realtime, burbuja flotante global con historial
paginado y no leídos. HOY solo envía texto. Ese es el mayor salto pendiente.

Lo que aún se siente v1: chat plano, notificaciones no del todo confiables (no
todo evento llega al inbox ni por correo), sin automatizaciones, sin reacciones,
sin búsqueda global fuerte, móvil mejorable.

---

## Track 1: Chat con superpoderes (prioridad de Ali)

Objetivo: que el chat pase de "mensajería" a "centro de trabajo del equipo".

### Circuito 1.A, adjuntar una tarea al mensaje (riesgo bajo)
- Entregable: botón en el compositor que abre un buscador de tareas del equipo y
  publica una tarjeta enlazada (título, estado, prioridad, asignado, link al
  panel). Al hacer clic abre la tarea.
- DB: sin tabla nueva. Se guarda un marcador en el `body` o una columna
  `attachments jsonb` aditiva en `messages` (default `[]`). Preferencia: columna
  `jsonb` para no ensuciar el texto.
- Render: `TeamChat`/`ProjectChat` detectan el adjunto y pintan la tarjeta.
- Aceptación: adjuntar una tarea real, verla como tarjeta en vivo (Realtime) y
  abrirla desde el chat.

### Circuito 1.B, adjuntar archivos (riesgo medio)
- Entregable: subir archivo desde el chat (imagen se previsualiza; otros como
  chip descargable). Reusa el patrón de `task-files`.
- DB + storage: bucket privado nuevo `chat-files` (o carpeta scoped dentro del
  existente) + registro en la misma columna `attachments jsonb` del mensaje, con
  signed URL temporal al leer. Allowlist de mime y límite 25MB, igual que tareas.
- Seguridad: reusar `canAccessTeamChat`; el path scoped por team_id; nunca IDs
  desde el body.
- Aceptación: subir una imagen y un PDF, verlos en el hilo, descargar con signed
  URL, sin fuga entre equipos.

### Circuito 1.C, recordatorios desde el chat (riesgo medio)
- Entregable: desde un mensaje, "crear recordatorio" (a mí o a alguien del
  equipo) con fecha y hora; llega al inbox y opcionalmente por correo.
- DB: tabla `reminders` (si no existe) con owner, target, due_at, source
  (message/task), payload. Enganchar al cron `due-reminders` ya existente.
- Aceptación: crear un recordatorio desde un mensaje y recibir la notificación a
  su hora.

### Circuito 1.D, reacciones emoji en mensajes (riesgo bajo, quick win)
- Entregable: reaccionar a un mensaje; agregación por tipo. (Emojis SON válidos
  aquí como dato de reacción del usuario, no como UI decorativa nuestra.)
- DB: tabla genérica `reactions` (target_type, target_id, profile_id, emoji).
- Aceptación: reaccionar y ver el conteo en vivo entre dos sesiones.

---

## Track 2: Notificaciones confiables

Objetivo: que menciones, asignaciones, comentarios y vencimientos SIEMPRE lleguen.

- Circuito 2.A: auditar y cerrar los eventos que hoy no escriben al inbox
  (mención en nota, asignación de tarea, respuesta a comentario, mensaje de chat
  dirigido). Un helper único `notify()` en `src/lib/activity.ts`.
- Circuito 2.B: correo para menciones y asignaciones, con preferencia por usuario
  (opt out). Usa el proveedor de correo del proyecto.
- Circuito 2.C: badge de no leídos consistente en sidebar (Bandeja) y campana.
- Aceptación: al asignarme una tarea y mencionarme en una nota, aparece en la
  Bandeja y (si opté) en el correo.

---

## Track 3: Automatizaciones (motor de reglas)

Objetivo: "cuando pase X, haz Y" sin código. Es un módulo, se diseña aparte.

- Circuito 3.A: modelo de datos. Tabla `automations` (workspace/proyecto,
  trigger, condiciones, acciones jsonb, activo). Triggers v1: cambia estado,
  se asigna, se vence, se crea tarea. Acciones v1: asignar, mover de estado o
  sprint, notificar, publicar en chat.
- Circuito 3.B: motor. Ejecutar reglas en los puntos de escritura de tareas
  (patrón hook en `api/tasks/**`) y en el cron para vencimientos.
- Circuito 3.C: UI en configuración del proyecto para crear reglas simples con
  selects (sin JSON a la vista).
- Aceptación: una regla "al mover a En revisión, asignar a QA y avisar en el
  chat" que se dispara sola.

---

## Track 4: Pulido que quita la sensación de v1

- Búsqueda global fuerte (Cmd+K) sobre tareas, notas y personas con resultados
  agrupados y navegación por teclado.
- Dashboard de Inicio con widgets: tareas por estado, vencidas, carga por
  persona, actividad reciente.
- Pase móvil: paneles y tablero utilizables en pantalla chica.
- Empty states y microcopys consistentes en todas las vistas.
- Estados de carga y error unificados (skeletons + reintentar), como el que ya
  se puso en el chat flotante.

---

## Orden de ejecución sugerido

1. Track 1.A (adjuntar tarea) y 1.D (reacciones): quick wins vistosos, bajo riesgo.
2. Track 1.B (archivos en chat): valor alto, reusa `task-files`.
3. Track 2 (notificaciones confiables): base para que todo lo demás avise bien.
4. Track 1.C (recordatorios) apoyado en Track 2.
5. Track 3 (automatizaciones): el módulo grande, ya con notificaciones sólidas.
6. Track 4 (pulido) en paralelo, en ratos cortos entre circuitos.

Cada circuito es shippable por sí solo. Al terminar uno: tsc + build EXIT 0,
deploy prod, entrada al changelog, y commit.
