# Skill: Auditoría de Egress

Audita el código del proyecto Work OS para detectar y corregir problemas de consumo de egress de Supabase.

## Argumento
$ARGUMENTS — archivo, carpeta o descripción del código a auditar

## Lista de verificación (revisa TODOS estos puntos)

### 🔴 Crítico — corregir inmediatamente

| Check | Problema | Corrección |
|-------|----------|------------|
| `select('*')` | Trae todas las columnas incluyendo JSONB pesados | Especificar columnas explícitas |
| `description` en lista | Tiptap JSON puede ser 50KB+ por tarea | Solo en detalle (`/tasks/[id]`) |
| Avatar en Storage | Duplica archivos, paga egress | Usar URL de Google CDN |
| Archivo Drive en Storage | Copia archivos de Drive innecesariamente | Solo metadata (id, nombre, url) |
| Realtime sin filter | Recibe TODOS los cambios de la tabla | Agregar `filter: col=eq.val` |
| Sin paginación | Carga registros sin límite | `.limit(50)` + cursor |
| `note.content` en lista | JSONB pesado innecesario | Solo en vista individual |
| `whiteboard.content` en lista | Excalidraw JSON puede ser MB | Solo cuando se abre |

### 🟠 Alto — corregir pronto

| Check | Problema | Corrección |
|-------|----------|------------|
| Sin staleTime en Query | Re-fetches innecesarios | Agregar staleTime apropiado |
| Import Excalidraw directo | Bundle de 1MB en primera carga | `dynamic(() => import(...), { ssr: false })` |
| Sin cleanup de canal Realtime | Memory leak + conexiones abiertas | `return () => supabase.removeChannel(channel)` |
| Imágenes sin comprimir | Uploads de 5-10MB | Comprimir a 2MB antes de subir |
| Sin límite de Storage | Archivos de cualquier tamaño | `file_size_limit` en bucket |
| useEffect con fetch | Fetch directo sin cache | Usar TanStack Query |

### 🟡 Medio — buenas prácticas

| Check | Problema | Corrección |
|-------|----------|------------|
| Múltiples canales Realtime | Conexiones duplicadas | Un canal por contexto, compartido |
| Queries anidadas en N+1 | Una query por cada item de lista | Usar `.select()` con relaciones |
| Sin índices en FK | Table scan en JOINs de RLS | `CREATE INDEX idx_tabla_col ON tabla(col)` |
| staleTime muy corto | Over-fetching de datos estáticos | 5min para proyectos/workspaces |

## Herramienta de análisis

Al invocar `/check-egress [archivo-o-ruta]`:

1. Lee el código especificado
2. Identifica cada problema de la lista de verificación
3. Reporta en formato:

```
AUDITORÍA DE EGRESS — [archivo]
================================

🔴 CRÍTICO (corregir ya):
  Línea 42: select('*') en useTasks — falta especificar columnas
  Línea 87: Sin filtro en canal Realtime de tasks

🟠 ALTO:
  Línea 15: Excalidraw importado directamente — usar dynamic import
  Línea 33: staleTime no definido en useProjects

🟡 MEDIO:
  Línea 60: staleTime de 30s para workspace list — puede ser 5min

✅ SIN PROBLEMAS: [lista de checks que pasaron]

ESTIMADO DE MEJORA: ~[X]% reducción en egress si se aplican los críticos
```

4. Propone el código corregido para cada problema crítico
