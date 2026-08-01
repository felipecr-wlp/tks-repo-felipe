# WLO (We Love Operations)

Sistema operativo interno de trabajo: tareas, proyectos, documentación, pizarras, metas y chat, en un solo lugar y con una sola sesión de Google.

**Producción:** [wlo.vercel.app](https://wlo.vercel.app) · **Stack:** Next.js 14 + Supabase + Vercel · **Idioma del producto:** español (con inglés disponible)

---

## Índice

1. [Qué es esto y para quién](#1-qué-es-esto-y-para-quién)
2. [Cómo se organiza la información](#2-cómo-se-organiza-la-información)
3. [Quién ve qué: roles, visibilidad y funciones](#3-quién-ve-qué-roles-visibilidad-y-funciones)
4. [Módulos del producto](#4-módulos-del-producto)
5. [Arquitectura técnica](#5-arquitectura-técnica)
6. [Mapa del repositorio](#6-mapa-del-repositorio)
7. [Puesta en marcha local](#7-puesta-en-marcha-local)
8. [Base de datos y migraciones](#8-base-de-datos-y-migraciones)
9. [Despliegue](#9-despliegue)
10. [Pruebas y control de calidad](#10-pruebas-y-control-de-calidad)
11. [Convenciones que no se negocian](#11-convenciones-que-no-se-negocian)
12. [Trampas conocidas](#12-trampas-conocidas)
13. [Documentación adicional](#13-documentación-adicional)

---

## 1. Qué es esto y para quién

WLO es la herramienta interna donde el equipo planea, ejecuta y documenta su trabajo. Sustituye la mezcla de hojas de cálculo, chats sueltos y carpetas compartidas por un solo lugar con permisos reales.

La idea de producto se resume en tres decisiones:

- **Una sola puerta de entrada.** Se entra con la cuenta de Google de la empresa. No hay usuarios ni contraseñas que administrar, y quien sale de la empresa pierde el acceso al perder su cuenta.
- **Cada quien ve lo suyo.** El acceso no es un adorno de interfaz: está impuesto en la base de datos con Row Level Security. Si alguien no debe ver un proyecto, no lo ve aunque escriba la URL a mano.
- **La documentación vive junto al trabajo.** Los procedimientos, las notas y las pizarras no están en otra herramienta: están al lado de las tareas que describen.

Referencias en lenguaje llano para quien apenas llega:

- **Workspace** es la empresa o la unidad grande (por ejemplo, "General").
- **Equipo** es un área dentro del workspace (Marketing, Operaciones).
- **Proyecto** es un tablero de trabajo dentro de un equipo.
- **Tarea** es la unidad mínima: tiene responsable, fecha, estado y prioridad.

---

## 2. Cómo se organiza la información

```
Organización
└── Workspace                     (uno por empresa o unidad; "General")
    ├── workspace_members         (rol de cada persona en el workspace)
    ├── Departamentos / spaces    (agrupan equipos y ordenan la documentación)
    └── Equipos (teams)
        ├── team_members
        ├── Documentos del equipo
        ├── Chat del equipo
        └── Proyectos
            ├── project_members
            ├── project_statuses  (columnas propias de cada proyecto)
            └── Tareas
                ├── responsables, etiquetas, prioridad, fechas
                ├── comentarios y adjuntos
                ├── checklists
                ├── dependencias entre tareas
                └── campos personalizados
```

Transversales al árbol: **Notas** (documentos y SOPs), **Pizarras** (Excalidraw), **Metas**, **Analítica**, **Tracking de tiempo**, **Academia** e **Inbox** de notificaciones.

---

## 3. Quién ve qué: roles, visibilidad y funciones

Son tres mecanismos distintos y conviene no confundirlos.

### 3.1 Rol: qué tanto PUEDE hacer una persona

| Nivel | Campo | Valores |
|---|---|---|
| Organización | `profiles.org_role` | `owner`, `admin`, `member` |
| Workspace | `workspace_members.role` | `owner`, `admin`, `manager`, `member`, `viewer` |
| Proyecto | `project_members.role` | `manager`, `member`, `viewer` |

Herencia: quien es owner o admin de la organización ve todo el workspace, incluidos equipos donde no participa (es supervisión, no membresía). Un rol de proyecto nunca supera al rol de organización.

### 3.2 Visibilidad: hasta dónde llega un recurso

Notas, pizarras y adjuntos llevan un campo `visibility`:

| Valor | Quién lo ve |
|---|---|
| `private` | solo quien lo creó |
| `project` | miembros del proyecto |
| `team` | miembros del equipo |
| `workspace` | todo el workspace |

Notas y pizarras nacen **privadas** por decisión explícita: publicar es un acto deliberado, no un descuido.

### 3.3 Funciones: qué tanto QUIERE ver una persona

En `Ajustes > Miembros` cada persona tiene interruptores por pantalla (Metas, Analítica, Tracking, Academia y demás). Sirve para que a quien solo usa tareas no le estorbe el resto.

Tres detalles de diseño que importan al tocar este código:

- Se guarda **lo oculto** (`workspace_members.hidden_features`), no lo permitido. Así una pantalla nueva llega a todos sin darla de alta persona por persona.
- El bloqueo es **real**: el catálogo vive en `src/lib/features.ts`, el middleware inyecta `x-pathname` y el layout del workspace redirige si la ruta está apagada. No abre por URL.
- Inicio, los equipos y sus proyectos están marcados como `locked` y no se pueden apagar, para que nadie quede encerrado fuera de su trabajo.

---

## 4. Módulos del producto

| Módulo | Ruta | Qué hace |
|---|---|---|
| Inicio | `/w/[ws]` | Panel del día: pendientes, widgets, guía de onboarding |
| Bandeja | `/w/[ws]/inbox` | Notificaciones: menciones, asignaciones, vencimientos |
| Mis tareas | `/w/[ws]/my-tasks` | Todo lo asignado a la persona, cruzando proyectos |
| Proyectos | `/w/[ws]/t/[equipo]/p/[proyecto]` | Nueve vistas: lista, tabla, tablero, calendario, cronograma, carga de trabajo, chat, automatizaciones y estados |
| Notas y SOPs | `/w/[ws]/notes` | Documentos con Tiptap: portadas, plantillas, versiones, enlaces entre notas, acuse de lectura y recordatorios de revisión |
| Pizarras | `/w/[ws]/whiteboards` | Excalidraw, incrustables dentro de una nota |
| Calendario | `/w/[ws]/calendar` | Tareas con fecha, con sincronización opcional a Google Calendar |
| Metas | `/w/[ws]/goals` | Objetivos con avance ligado a tareas |
| Analítica | `/w/[ws]/analytics` | Métricas de entrega por equipo y proyecto |
| Tracking | `/w/[ws]/tracking` | Registro de tiempo por tarea |
| Academia | `/w/[ws]/academia` | Cursos y evaluaciones internas |
| General | `/w/[ws]/general` | Chat del workspace |
| CV | `/w/[ws]/cv/[id]` | Perfil profesional interno de cada persona |
| Ajustes | `/w/[ws]/settings` | Workspace, sala de espera, miembros, equipos, departamentos, accesos, invitaciones, rendimiento y academia |

### KERN, el asistente

Burbuja flotante disponible en toda la app (`src/components/kern/`), conectada a Gemini Flash con streaming. No es un chat decorativo: **ejecuta herramientas** contra la base de datos respetando los permisos de quien pregunta (`src/lib/ai/kern-tools.ts`). Puede listar proyectos, buscar y crear tareas, leer documentos y escribir en ellos. Sus respuestas se renderizan con un parser de markdown propio que devuelve nodos de React, nunca HTML inyectado.

Aparte, el editor de notas tiene un botón de IA (`/api/ai/text`) para mejorar redacción, corregir ortografía, acortar, resumir o ampliar. Nunca escribe solo: muestra el resultado y hay que confirmar el reemplazo.

---

## 5. Arquitectura técnica

| Capa | Tecnología |
|---|---|
| Framework | Next.js 14 (App Router, Server Components por defecto) |
| Hosting y cron | Vercel |
| Base de datos, auth, storage y realtime | Supabase (PostgreSQL con RLS) |
| Autenticación | Google OAuth, con restricción por dominio de correo |
| Editor rico | Tiptap v2 |
| Pizarra | Excalidraw (carga diferida) |
| UI | Tailwind CSS + componentes propios + iconos lucide |
| IA | Google Gemini Flash vía Vercel AI SDK (`ai`, `@ai-sdk/google`) |
| Formularios y validación | React Hook Form + Zod |
| Estado de servidor | TanStack Query v5 |
| Estado global | Zustand |
| Arrastrar y soltar | dnd-kit |
| Orden de listas | fractional-indexing |
| Correo | Resend + React Email |
| Rate limiting | Upstash Redis |
| Sanitización | isomorphic-dompurify |
| Pruebas | Vitest (unitarias e invariantes) + Playwright (e2e) |

**Flujo de una petición típica:** el navegador llama a un Route Handler en `src/app/api/`, que valida el cuerpo con Zod, aplica rate limiting, verifica permisos con los helpers de `src/lib/` (`task-access.ts`, `team-access.ts`, `workspace-admin.ts`, `note-visibility.ts`), toca Supabase con columnas explícitas y registra la mutación con `logActivity()`.

---

## 6. Mapa del repositorio

```
src/
  app/
    (app)/w/[workspaceSlug]/   pantallas del workspace (Server Components)
    api/                       Route Handlers, uno por recurso
    auth/                      login y pantalla de acceso denegado
  components/
    sidebar/                   barra lateral, switcher de workspace, menú de usuario
    tasks/                     vistas de tareas (lista, tabla, kanban, cronograma, carga)
    editor/                    Tiptap, menú slash, callouts, toggles, menú de IA
    kern/                      asistente KERN y su renderizador de markdown
    chat/                      chat flotante de equipos
    notes/ whiteboards/ ui/    documentación, pizarras y primitivas visuales
  lib/
    features.ts                catálogo de pantallas y quién puede verlas
    supabase/                  clientes de servidor, navegador y admin, más tipos
    ai/                        cliente Gemini, prompts, herramientas de KERN
    *-access.ts                helpers de permisos, la fuente de verdad de autorización
    activity.ts                logActivity(), el registro de auditoría
  middleware.ts                sesión, restricción de dominio y cabecera x-pathname
supabase/migrations/           57 migraciones SQL, en orden cronológico
tests/                         71 archivos, en su mayoría invariantes de seguridad
docs/                          auditorías, roadmaps y bitácora de coordinación
```

---

## 7. Puesta en marcha local

Requisitos: Node 20 o superior y una cuenta de Supabase.

```bash
git clone https://github.com/PAVIFIC/tskr.git
cd tskr
npm install
cp .env.example .env.local   # rellenar con valores reales
npm run dev                  # http://localhost:3000
```

Variables de entorno (todas viven en `.env.local`, que **nunca** se commitea):

| Variable | Para qué | Obligatoria |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave pública de Supabase | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de servicio, solo servidor | sí |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth y Google Calendar | sí |
| `ALLOWED_EMAIL_DOMAINS` | dominios de correo con permiso de entrar, separados por coma (se acepta `ALLOWED_EMAIL_DOMAIN` como respaldo) | sí |
| `NEXT_PUBLIC_APP_URL` | URL base para enlaces de correo | sí |
| `GEMINI_API_KEY` | KERN y la IA del editor | opcional |
| `GEMINI_MODEL` | modelo a usar, si se quiere otro | opcional |
| `RESEND_API_KEY` / `EMAIL_FROM` | envío de correo | opcional |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | rate limiting distribuido. Los inyecta sola la integración de Upstash del Marketplace de Vercel, no se ponen a mano. En local se acepta el alias `UPSTASH_REDIS_REST_URL` / `_TOKEN`. Nunca uses el `KV_REST_API_READ_ONLY_TOKEN`: el limiter escribe contadores | opcional |
| `CRON_SECRET` | protege los endpoints de cron | en producción, sí |

Sin `GEMINI_API_KEY` la app funciona completa; solo las funciones de IA responden 503 con un mensaje claro.

Comandos disponibles:

```bash
npm run dev           # servidor de desarrollo
npm run build         # build de producción
npm run lint          # ESLint
npm run type-check    # tsc --noEmit
npm test              # Vitest, una pasada
npm run test:watch    # Vitest en modo watch
npm run test:e2e      # Playwright
```

---

## 8. Base de datos y migraciones

Todo cambio de esquema entra como archivo SQL en `supabase/migrations/`, con nombre `YYYYMMDDHHMMSS_descripcion.sql`. No se toca la base desde la interfaz de Supabase sin dejar la migración correspondiente.

```bash
npm run db:migration nombre_del_cambio   # crea el archivo
npm run db:push                          # aplica a la base enlazada
npm run db:generate-types                # regenera src/lib/supabase/types.ts
```

Reglas de la casa al escribir SQL:

1. **RLS en todas las tablas**, sin excepción.
2. Índices para toda columna que se filtre u ordene.
3. Nunca una política RLS que consulte su propia tabla en una subconsulta: Postgres devuelve `42P17` (recursión infinita) y la pantalla completa deja de cargar.
4. Nunca una llave foránea que cierre un ciclo entre tablas ya relacionadas: PostgREST responde `HTTP 300` en todos los embeds y la app entera se cae con "Página no encontrada".

Si tras una migración todo el mundo ve "Página no encontrada", el primer lugar donde mirar son los logs de la API de Supabase buscando `300` o `42P17`.

---

## 9. Despliegue

El proyecto vive en Vercel, pero **no se despliega solo al hacer push**. Publicar requiere el CLI:

```bash
git push origin master
npx vercel --prod --yes --token "$TOKEN"
npx vercel ls --prod --token "$TOKEN"    # confirmar que quedó Ready
```

Hay dos tareas programadas declaradas en `vercel.json`:

| Ruta | Horario (UTC) | Qué hace |
|---|---|---|
| `/api/cron/due-reminders` | 15:00 diario | avisa de tareas por vencer |
| `/api/cron/sop-reviews` | 16:00 diario | recuerda revisar procedimientos vencidos |

Ambas se autentican con `CRON_SECRET`.

---

## 10. Pruebas y control de calidad

La carpeta `tests/` no son pruebas de funcionalidad al uso: en su mayoría son **invariantes de seguridad** que recorren el código fuente y fallan si alguien rompe una regla estructural. Por ejemplo:

- `auth-invariant.test.ts`: todo Route Handler verifica sesión.
- `mass-assignment-invariant.test.ts`: ningún handler pasa el cuerpo de la petición directo a la base.
- `explicit-column-select-invariant.test.ts`: ningún `select *`.
- `cross-tenant-reference-invariant.test.ts`: ningún identificador cruza de un tenant a otro.
- `rls-*` y `migration-schema-invariant.test.ts`: toda tabla nueva llega con RLS.

Esto significa que al agregar un endpoint nuevo probablemente falle alguna prueba hasta que cumpla el patrón. Es el comportamiento buscado: la prueba está enseñando la convención, no estorbando.

Antes de cada commit: `npm run type-check`, `npm run build` y `npm test`.

---

## 11. Convenciones que no se negocian

**Producto y redacción**

- Prohibidos el guion largo (em dash) y el guion medio (en dash) en cualquier texto: código, comentarios, cadenas visibles, títulos y documentación. Se reemplazan por punto, coma, dos puntos, paréntesis o reformulando.
- El español visible lleva su ñ y sus tildes: "campaña", "diseño". Los identificadores técnicos (claves, slugs) pueden quedar en ASCII.
- Iconos SVG de lucide, nunca emojis en la interfaz.
- Los comentarios explican **por qué** se tomó una decisión, no qué hace la línea siguiente.

**Código**

- Server Components por defecto; `'use client'` solo cuando hay interactividad real.
- Validación con Zod antes de tocar la base, en todos los Route Handlers.
- Columnas explícitas en todo `select`, nunca `*`.
- Nunca `task.description` en consultas de lista: solo al abrir el detalle.
- Paginar siempre (50 elementos, con cursor).
- Realtime siempre con filtro (`filter: columna=eq.valor`), nunca suscripción a la tabla completa.
- Carga diferida obligatoria para Excalidraw y Tiptap.
- Errores: devolver `{ error: string }` con el código HTTP correcto, sin filtrar detalles internos.
- Llamar `logActivity()` en cada mutación relevante.
- Nada de secretos en variables `NEXT_PUBLIC_`.

---

## 12. Trampas conocidas

Cosas que ya costaron caro una vez:

- **Un layout de servidor no conoce su propia URL.** Por eso el middleware inyecta `x-pathname` en las cabeceras de la *petición* (`NextResponse.next({ request: { headers } })`). Ponerlo en la respuesta no sirve: `headers()` no lo lee. Al reconstruir la respuesta hay que copiar las cookies que Supabase acaba de refrescar, o se cierra la sesión de todos.
- **Migraciones:** ver las reglas 3 y 4 de la sección 8. Son las dos formas conocidas de tumbar la aplicación completa con una sola línea de SQL.
- **La IA no decide permisos.** Las herramientas de KERN vuelven a verificar el acceso del usuario en cada llamada. El modelo propone, el servidor dispone.
- **Editar las funciones de uno mismo.** El panel de miembros permite apagarse pantallas a sí mismo. Quien se apague Ajustes necesita que otro administrador se lo devuelva.

---

## 13. Documentación adicional

| Archivo | Contenido |
|---|---|
| `CLAUDE.md` | contexto técnico para asistentes de IA que trabajen en el repo |
| `docs/AUDIT-WLO-2026-07-18.md` | auditoría general del producto |
| `docs/ROADMAP-CLICKUP-PARITY.md` | brechas contra ClickUp y qué falta |
| `docs/ROADMAP-V2-CHAT-Y-PULIDO.md` | plan de la siguiente versión |
| `docs/ROUND2` a `ROUND5` | rondas de revisión de flujo y de interfaz |
| `docs/COLAB-CHANGELOG.md` | bitácora de cambios de colaboración |
| `docs/coordination/` | auditorías y acuerdos por conversación |

---

Repositorio privado de PAVIFIC. Para dudas de arquitectura, empezar por `src/lib/features.ts` y `src/middleware.ts`: ahí se entiende en diez minutos cómo se decide quién ve qué.
