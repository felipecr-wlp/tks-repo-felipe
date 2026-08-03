# WLO Plugin System — Documentación de Desarrollo

> **Acceso**: Este archivo está en `docs/plugin-development.md` del repositorio.
> Abre `http://localhost:3000/w/general/settings/plugins` para administrar plugins.

## Tipos de Plugin (campo `type` en manifest.json)

| `type` | Descripción | Dónde aparece | Ejemplo |
|--------|-------------|---------------|---------|
| `"widget"` | Componente visual pequeño | **Dashboard** (slot `dashboard`) | Contador, Reloj |
| `"page"` | Aplicación completa con rutas | **Sidebar → Complementos** | Flows |

> ⚠️ **Importante**: El `type` en manifest.json determina TODO el comportamiento:
> - `"widget"` → solo dashboard, no aparece en sidebar, no tiene selector de slots
> - `"page"` → aparece en sidebar Complementos, tiene selector de slots (dashboard, workspace, complementos)

## Arquitectura General

```
plugins/                          ← Directorio físico de plugins (un plugin = un directorio)
├── mi-plugin/
│   ├── manifest.json             ← Metadatos, slots, rutas, configuración
│   ├── page.js                   ← Código del plugin (widget o página)
│   ├── components/               ← Componentes React adicionales (opcional)
│   └── api/                      ← API handlers del plugin (opcional)
│       └── ...
```

### Capas del sistema

| Capa | Ubicación | Propósito |
|------|-----------|-----------|
| **Manifiesto** | `plugins/{id}/manifest.json` | Define nombre, versión, slots, permisos |
| **Código de plugin** | `plugins/{id}/page.js` | Componente React exportado como `module.exports = { default: MiPlugin }` |
| **Registro en DB** | `connector_apps` + `connector_installs` | Instalación, activación, configuración |
| **WidgetSlot** | `src/lib/widgets/WidgetSlot.tsx` | Contenedor que carga y renderiza widgets dinámicamente |
| **Sidebar** | `src/components/sidebar/Sidebar.tsx` | Muestra plugins instalados en "Complementos" |
| **Panel Admin** | `/w/:slug/settings/plugins` | Instalar, desinstalar, configurar |

### Ciclo de vida

```
Crear plugin → Subir ZIP → Extraer a plugins/ → Registrar en DB → Sidebar lo muestra → Widgets renderizan
                                                                         ↓
                                              Desinstalar → Borrar de DB + Borrar archivos → Desaparece
```

---

## Tipos de Plugin

### 1. Widget (type: "widget")

Componente visual que se renderiza en el dashboard dentro de un `WidgetSlot`.

**Slots disponibles**:
- `dashboard` — aparece en el dashboard del workspace
- `sidebar-complementos` — aparece en la sección Complementos del menú lateral
- `sidebar-workspace` — aparece en el menú Workspace

### 2. Página (type: "page")

Módulo completo con rutas, API endpoints y páginas. Se accede via `/w/:slug/p/:pluginId`.

---

## Crear un Widget — Paso a Paso

### 1. Estructura de archivos

```
plugins/wlo-mi-widget/
├── manifest.json
└── page.js
```

### 2. manifest.json

```json
{
  "name": "Mi Widget",
  "id": "wlo-mi-widget",
  "version": "1.0.0",
  "type": "widget",
  "icon": "heart",
  "description": "Descripción breve del widget",
  "author": "Tu Nombre",
  "wlo_version": ">=1.0.0",
  "slots": ["dashboard"],
  "component": "mi-widget"
}
```

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `name` | Sí | Nombre visible |
| `id` | Sí | Identificador único (prefijo `wlo-`) |
| `version` | Sí | Versión semántica |
| `type` | Sí | `"widget"` o `"page"` — define dónde aparece el plugin |
| `icon` | Sí | Nombre de icono Lucide |
| `slots` | Sí | Dónde aparece el widget |
| `component` | No | Nombre del componente (widget) |
| `description` | No | Descripción |
| `author` | No | Autor |
| `wlo_version` | No | Versión mínima de WLO requerida |

### 3. page.js — Widget funcional

```javascript
// plugins/wlo-mi-widget/page.js
const React = require('react')
const { useState } = React

function MiWidget() {
  const [valor, setValor] = useState(0)

  return React.createElement('div',
    { className: 'border rounded-xl p-4 bg-card h-full' },

    // Título
    React.createElement('h4',
      { className: 'text-xs font-semibold text-muted-foreground mb-3' },
      'Mi Widget'
    ),

    // Contenido
    React.createElement('div',
      { className: 'flex flex-col items-center gap-2' },
      React.createElement('span',
        { className: 'text-3xl font-bold' },
        String(valor)
      ),
      React.createElement('div',
        { className: 'flex gap-1' },
        React.createElement('button', {
          onClick: function() { setValor(function(v) { return v - 1 }) },
          className: 'w-8 h-8 rounded bg-muted hover:bg-accent text-sm'
        }, '-'),
        React.createElement('button', {
          onClick: function() { setValor(function(v) { return v + 1 }) },
          className: 'w-8 h-8 rounded bg-muted hover:bg-accent text-sm'
        }, '+')
      )
    )
  )
}

module.exports = { default: MiWidget }
```

**Reglas para page.js**:
1. Usar `const React = require('react')` al inicio
2. Usar `React.createElement()` — NO usar JSX
3. Usar `function()` tradicional (no arrow functions) para callbacks
4. Exportar con `module.exports = { default: MiFuncion }`
5. Los hooks de React (`useState`, `useEffect`) se importan de `React`

### 4. Empaquetar como ZIP

```
wlo-mi-widget.wlo-plugin.zip
├── manifest.json
└── page.js
```

### 5. Instalar

1. Ve a **Configuración → Plugins**
2. Clic en **Subir plugin (.zip)**
3. Selecciona el archivo ZIP
4. El plugin aparece en la lista y en el dashboard

### 6. Distribuir

- **Descargar**: desde Configuración → Plugins → clic en el plugin → **Descargar**
- **Compartir**: envía el ZIP a otros workspaces
- **Desinstalar**: borra el plugin completamente (archivos + registro)

---

## Crear una Página (type: "page")

### Estructura

```
plugins/wlo-mi-pagina/
├── manifest.json
├── page.js                      ← Punto de entrada
├── pages/
│   ├── list.js                  ← Página de lista
│   └── [id]/
│       └── detail.js            ← Página de detalle
├── components/
│   └── MiComponente.js          ← Componentes auxiliares
└── api/
    ├── list.js                  ← API GET/POST
    └── [id]/
        └── detail.js            ← API GET/PATCH/DELETE
```

### manifest.json (página)

```json
{
  "name": "Mi Módulo",
  "id": "wlo-mi-pagina",
  "version": "1.0.0",
  "type": "page",
  "icon": "layout-grid",
  "description": "Módulo completo con rutas propias",
  "author": "Tu Nombre",
  "wlo_version": ">=1.0.0",
  "slots": ["sidebar-complementos"],
  "routes": [
    { "path": "/w/:slug/mi-pagina", "label": "Mi Módulo", "labelKey": "nav.miModulo" }
  ],
  "api": [
    { "path": "/api/mi-pagina", "methods": ["GET", "POST"] }
  ],
  "permissions": ["read:workspace", "write:mi-pagina"],
  "tables": ["mi_tabla"]
}
```

---

## API Reference

### Instalación / Desinstalación

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/plugins/catalog?workspace_id=` | Lista plugins disponibles |
| `POST` | `/api/plugins` | Instalar plugin |
| `DELETE` | `/api/plugins/:id` | Desinstalar (borra archivos) |
| `PATCH` | `/api/plugins/:id/config` | Configurar (slots, enabled) |
| `POST` | `/api/plugins/upload` | Subir ZIP (multipart) |
| `GET` | `/api/plugins/:id/download` | Descargar ZIP |
| `GET` | `/api/widgets?workspace_id=&slot=` | Widgets instalados |
| `GET` | `/api/widgets/component/:appId` | Código del widget |

### Widgets instalados

```json
// GET /api/widgets?workspace_id=xxx&slot=dashboard
{
  "widgets": [
    {
      "id": "uuid",
      "app_id": "wlo-counter",
      "plugin_type": "widget",
      "enabled": true,
      "widget": {
        "id": "wlo-counter",
        "name": "Contador",
        "icon": "hash",
        "slot": "dashboard",
        "component": "sample-counter"
      }
    }
  ]
}
```

---

## Hooks de React Disponibles

En `page.js`, tienes acceso a React completo via `require('react')`:

```javascript
const React = require('react')
const { useState, useEffect, useCallback, useRef, useMemo } = React
```

---

## Estilos Disponibles

Todos los plugins tienen acceso al sistema de diseño de WLO (Tailwind CSS + shadcn/ui tokens):

```javascript
// Clases CSS disponibles
'bg-card'           // Fondo de tarjeta
'border-border'     // Color de borde
'text-primary'      // Texto principal
'text-muted-foreground'  // Texto secundario
'bg-muted'          // Fondo secundario
'hover:bg-accent'   // Hover
'rounded-xl'        // Bordes redondeados
'shadow-sm'         // Sombra
```

---

## Íconos Disponibles (Lucide)

```
hash, clock, workflow, heart, star, settings, user, mail, bell,
calendar, file-text, search, plus, trash, edit, eye, lock, unlock,
play, pause, download, upload, share, link, globe, home, inbox,
check, x, arrow-up, arrow-down, arrow-left, arrow-right, ...
```

[Lista completa de Lucide icons](https://lucide.dev/icons)

---

## Ejemplo Completo: Widget de Notas Rápidas

```javascript
// plugins/wlo-quick-notes/page.js
const React = require('react')
const { useState } = React

function QuickNotes() {
  const [notes, setNotes] = useState([])
  const [text, setText] = useState('')

  function addNote() {
    if (!text.trim()) return
    setNotes(function(prev) { return [...prev, text] })
    setText('')
  }

  return React.createElement('div',
    { className: 'border rounded-xl p-4 bg-card h-full' },
    React.createElement('h4',
      { className: 'text-xs font-semibold text-muted-foreground mb-3' },
      'Notas Rapidas'
    ),
    React.createElement('div',
      { className: 'flex gap-2 mb-3' },
      React.createElement('input', {
        value: text,
        onChange: function(e) { setText(e.target.value) },
        onKeyDown: function(e) { if (e.key === 'Enter') addNote() },
        className: 'flex-1 h-8 rounded border bg-background px-2 text-sm outline-none',
        placeholder: 'Escribe una nota...'
      }),
      React.createElement('button', {
        onClick: addNote,
        className: 'px-3 h-8 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90'
      }, '+')
    ),
    React.createElement('div',
      { className: 'space-y-1 max-h-40 overflow-y-auto' },
      notes.map(function(note, i) {
        return React.createElement('div', {
          key: i,
          className: 'text-xs py-1 px-2 rounded bg-muted/50'
        }, note)
      })
    )
  )
}

module.exports = { default: QuickNotes }
```

### manifest.json para Quick Notes

```json
{
  "name": "Notas Rapidas",
  "id": "wlo-quick-notes",
  "version": "1.0.0",
  "type": "widget",
  "icon": "file-text",
  "description": "Widget para tomar notas rapidas en el dashboard",
  "author": "Tu Nombre",
  "wlo_version": ">=1.0.0",
  "slots": ["dashboard"],
  "component": "quick-notes"
}
```

---

---

## Comunicación Plugin ↔ WLO

### A. Contexto que recibe el plugin

Todo plugin recibe datos del workspace vía **URL query params** en el iframe:

```
?workspace_id=d7c9516d-...&workspace_slug=general&app_id=wlo-mi-plugin
```

| Parámetro | Descripción |
|-----------|-------------|
| `workspace_id` | UUID del workspace actual |
| `workspace_slug` | Slug del workspace |
| `app_id` | ID del plugin |

```javascript
// Leer contexto desde el plugin
const params = new URLSearchParams(window.location.search)
const wsId = params.get('workspace_id')
const wsSlug = params.get('workspace_slug')
```

### B. Comunicación iframe → WLO (postMessage)

Desde un widget o página cargada en iframe:

```javascript
// Ajustar altura del iframe automáticamente
window.parent.postMessage({
  type: 'wlo-resize',
  height: document.body.scrollHeight + 20
}, '*')

// Enviar evento personalizado a WLO
window.parent.postMessage({
  type: 'wlo-event',
  action: 'task-created',
  data: { id: 'uuid', title: 'Nueva tarea' }
}, '*')

// Navegar en WLO desde el plugin
window.parent.postMessage({
  type: 'wlo-navigate',
  path: '/w/general/projects'
}, '*')
```

### C. API REST de WLO (PostgREST Supabase)

Todos los plugins pueden usar la API REST directamente. Las credenciales vienen del contexto del workspace.

```javascript
// URL base de Supabase para REST API
const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co'
const ANON_KEY = 'eyJ...'  // Disponible en el contexto

// Ejemplo: listar tareas del workspace
const res = await fetch(`${SUPABASE_URL}/rest/v1/tasks?workspace_id=eq.${wsId}&limit=10`, {
  headers: {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json'
  }
})
const tasks = await res.json()
```

**Endpoints disponibles** (todos usan RLS automáticamente):

| Recurso | Endpoint | Operaciones |
|---------|----------|-------------|
| Tareas | `/rest/v1/tasks` | GET, POST, PATCH, DELETE |
| Proyectos | `/rest/v1/projects` | GET, POST, PATCH |
| Notas | `/rest/v1/notes` | GET, POST, PATCH, DELETE |
| Workspaces | `/rest/v1/workspaces` | GET (solo el propio) |
| Miembros | `/rest/v1/workspace_members` | GET |
| Actividad | `/rest/v1/activity_events` | GET |
| Notificaciones | `/rest/v1/notifications` | GET |

**Filtros comunes**:
```javascript
// Filtrar por workspace
?workspace_id=eq.${wsId}

// Filtrar por proyecto
?project_id=eq.${projectId}

// Ordenar
?order=created_at.desc

// Seleccionar columnas específicas
?select=id,title,status,assignee:profiles(display_name)

// Paginación
?limit=20&offset=0
```

### D. API de Conectores (app-to-app avanzado)

Para plugins que necesitan comunicación server-to-server con API keys:

```bash
# Crear API key desde el plugin
POST /api/connectors/keys
Body: { workspace_id, name: 'Mi Plugin', target_app: 'wlo', scopes: ['tasks:read'] }

# Llamar acciones de WLO
POST /api/connectors/call/tasks/create
Headers: Authorization: Bearer pck_live_xxx
Body: { title: 'Tarea desde plugin', project_id: '...' }
```

**Scopes disponibles**:

| Scope | Descripción |
|-------|-------------|
| `tasks:read` | Leer tareas |
| `tasks:write` | Crear/editar tareas |
| `projects:read` | Leer proyectos |
| `notes:read` | Leer notas |
| `workspace:read` | Leer workspace |
| `members:read` | Leer miembros |

### E. Webhooks (eventos)

Suscribirse a eventos de WLO para recibir notificaciones en tiempo real:

```bash
# Crear webhook
POST /api/connectors/webhooks
Body: {
  workspace_id, source_app: 'wlo',
  event: 'task.created',
  target_url: 'https://mi-plugin.com/webhook',
  secret: 'mi-secreto-hmac'
}
```

**Eventos disponibles**:
- `task.created`, `task.updated`, `task.deleted`
- `project.created`, `project.updated`
- `note.created`, `note.updated`
- `member.joined`

El webhook envía POST con HMAC-SHA256 en el header `X-WLO-Signature`.

```javascript
// Verificar firma en el plugin (Node.js)
const crypto = require('crypto')
const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')
const isValid = req.headers['x-wlo-signature'] === expected
```

---

## Debugging

### Ver logs del servidor
```bash
npm run dev
# Los errores de carga de plugins aparecen como:
# [plugin-registry] Error reading manifest for wlo-xxx
# [plugins] Deleted directory: .../plugins/wlo-xxx
```

### Verificar plugins instalados
```
GET /api/widgets?workspace_id=xxx&slot=dashboard
```

### Forzar recarga de widget
El WidgetSlot usa caché (`loadedComponents` Map). Para limpiar la caché, recarga la página (F5).

---

## Exponer tu Plugin — API REST + Inyección en WLO

### A. Exponer una API REST desde tu plugin

Tu plugin puede ser un servidor HTTP completo. WLO se comunica con él via HTTP:

```
Tu Plugin (Node.js, Python, PHP, etc.)
  ├── GET  /api/health          → health check
  ├── POST /api/receive-data    → WLO envía datos
  ├── GET  /api/get-data        → WLO consulta datos
  └── POST /webhook             → WLO notifica eventos
```

**Ejemplo: plugin con Express (Node.js)**

```javascript
// plugin-server.js - Deploy independiente
const express = require('express')
const app = express()
app.use(express.json())

// Health check (WLO verifica que el plugin esté vivo)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' })
})

// Recibir datos desde WLO
app.post('/api/receive', (req, res) => {
  const { workspace_id, event, data } = req.body
  // Procesar datos...
  console.log(`Workspace ${workspace_id}: ${event}`, data)
  res.json({ received: true })
})

// WLO consulta datos del plugin
app.get('/api/data', (req, res) => {
  const wsId = req.query.workspace_id
  res.json({ workspace: wsId, items: [] })
})

app.listen(process.env.PORT || 3001)
```

**Registrar en WLO**:

```json
// manifest.json
{
  "name": "Mi Plugin API",
  "id": "wlo-mi-api",
  "type": "page",
  "api": [
    { "path": "/api/receive", "method": "POST", "description": "Recibe datos de WLO" },
    { "path": "/api/data", "method": "GET", "description": "WLO consulta datos" }
  ],
  "webhooks": [
    { "event": "task.created", "description": "Notificar cuando se crea una tarea" }
  ]
}
```

### B. Inyección en páginas de WLO (Slots)

Los plugins pueden aparecer en ubicaciones específicas de WLO definidas en el manifest:

```json
{
  "slots": [
    "dashboard",         // Widget en el dashboard
    "sidebar-workspace", // Item en menú Workspace
    "sidebar-complementos", // Item en Complementos
    "header"             // Botón en barra superior
  ]
}
```

| Slot | Ubicación | Renderizado | Ideal para |
|------|-----------|-------------|------------|
| `dashboard` | Debajo de métricas en el dashboard | WidgetSlot (iframe) | Widgets, métricas |
| `sidebar-workspace` | Menú lateral → Workspace | NavItem con link | Páginas del plugin |
| `sidebar-complementos` | Menú lateral → Complementos | NavItem con link | Plugins instalables |
| `header` | Barra superior de la app | iframe pequeño | Botones, notificaciones |

**Ejemplo: plugin con widget + página + botón en header**:

```json
{
  "name": "Mi Plugin Completo",
  "id": "wlo-completo",
  "type": "page",
  "slots": ["dashboard", "sidebar-complementos", "header"],
  "routes": [
    { "path": "/w/:slug/p/wlo-completo", "label": "Mi Plugin" }
  ]
}
```

### C. Arquitectura de despliegue

```
┌────────────────────────────────────────────────┐
│ WLO (Next.js en Vercel)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ WidgetSlot│  │ Sidebar  │  │ p/ catch-all │ │
│  │ (iframe) │  │ (link)   │  │ (iframe)     │ │
│  └─────┬────┘  └────┬─────┘  └──────┬───────┘ │
└────────┼────────────┼───────────────┼──────────┘
         │            │               │
    ┌────▼────────────▼───────────────▼──────────┐
    │ Tu Plugin (deploy independiente)           │
    │ Puede ser: Vercel, Netlify, Railway,       │
    │ Cloudflare Workers, servidor propio        │
    │                                            │
    │  ├── page.js/html    ← Widget/página       │
    │  ├── server.js       ← API endpoints       │
    │  └── manifest.json   ← Registro en WLO     │
    └────────────────────────────────────────────┘
```

### D. Comunicación bidireccional completa

```
WLO → Plugin (iframe):
  URL params: ?workspace_id=xxx&workspace_slug=xxx

Plugin → WLO (postMessage):
  { type: 'wlo-resize', height: N }
  { type: 'wlo-navigate', path: '/w/slug/tasks' }
  { type: 'wlo-event', action: 'custom', data: {...} }

WLO → Plugin (HTTP):
  POST https://mi-plugin.com/api/receive
  GET  https://mi-plugin.com/api/data

Plugin → WLO (HTTP + API Key):
  GET  https://wlo.vercel.app/rest/v1/tasks
  POST https://wlo.vercel.app/api/connectors/call/...
```

---

## Limitaciones Actuales

| Limitación | Explicación |
|------------|-------------|
| Sin JSX en page.js | Los widgets se evalúan en runtime con `new Function()` |
| Sin imports de archivos locales | Todo el código debe estar en page.js |
| Sin CSS modules | Usar clases Tailwind inline |
| Páginas requieren código en src/ | Las rutas Next.js se compilan en build time |

---

## Roadmap

- [ ] Soporte para CSS custom en plugins
- [ ] Hot-reload de plugins sin reiniciar servidor
- [ ] Marketplace público
- [ ] Sandbox de seguridad (iframes para código no confiable)
- [ ] Migraciones automáticas al instalar
