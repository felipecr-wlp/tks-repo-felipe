/**
 * Export a PDF (branded WLP) del Cronograma (Gantt) para clientes.
 *
 * No toca la base ni el estado: recibe las tareas YA filtradas y ordenadas por el
 * componente, arma un documento HTML optimizado para impresion (A4 horizontal),
 * lo abre en una ventana nueva y dispara "Guardar como PDF" del navegador. Es un
 * export de solo lectura, aditivo y reversible.
 *
 * IDIOMA: el documento SIEMPRE se genera en INGLES, sin importar el idioma de la
 * app. Motivo: el ~99% de los clientes de WLP hablan ingles y este PDF es un
 * entregable de cara al cliente. Los titulos de tarea vienen de la base tal cual.
 *
 * LAYOUT: se usa una tabla real con <thead> (display: table-header-group) para que
 * el eje de fechas se REPITA en cada pagina impresa, y cada fila lleva
 * break-inside: avoid para no partirse. Asi se evitan los saltos de pagina feos
 * (grupos enteros empujados a la siguiente hoja) que tenia la version anterior.
 *
 * Branding oficial WLP: amarillo #FED500, negro #0A0A0A, blanco, crema #FFF4D6.
 * Las barras conservan el color por prioridad o por estado que Karla ve en
 * pantalla.
 */

export interface GanttExportTask {
  title: string
  assignee: string | null
  priority: string // 'urgent' | 'high' | 'medium' | 'low' | 'none'
  color: string // color resuelto de la barra (prioridad o estado)
  start: string // yyyy-mm-dd
  end: string // yyyy-mm-dd
  done: boolean
  overdue: boolean
  project?: string // opcional (vista de equipo: nombre del proyecto)
  label?: { name: string; color: string } // etiqueta/fase para mostrar como pill de color
}

export interface GanttExportGroup {
  // Codigo de categoria de estado ('todo' | 'in_progress' | 'done' | 'cancelled')
  // para resolver el nombre en ingles. Si no es una categoria conocida se usa
  // `label` tal cual (ej. grupos por responsable o por proyecto).
  category?: string
  label?: string
  items: GanttExportTask[]
}

export interface GanttExportParams {
  documentTitle?: string // "Project Schedule" (default) | "Team Schedule"
  title: string // nombre del proyecto o equipo (subtitulo en negrita)
  subtitle?: string // workspace
  groups: GanttExportGroup[]
  undated: { title: string; project?: string }[]
  // Portada branded opcional (entregable de cara al cliente). Si se pasa, se
  // antepone una hoja de portada con el panda y el nombre del cliente editable.
  cover?: { clientName?: string; serviceAddress?: string; pandaUrl?: string }
}

// ── Diccionarios en ingles (documento SIEMPRE en ingles) ─────────────────────
const LOCALE = 'en-US'
const PRIORITY_EN: Record<string, string> = {
  urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority',
}
const CATEGORY_EN: Record<string, string> = {
  todo: 'To do', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled',
}
const T = {
  generated: 'Generated',
  today: 'Today',
  overdue: 'Overdue',
  undated: 'No scheduled dates',
  days: 'd',
  columnTask: 'Task',
  scope: 'Scope of work',
  tasksWord: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`,
  footer: 'Schedule exported from WLO',
  priorities: { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' },
  dailyTitle: 'Daily Work Plan',
  dailyHint: 'Work scheduled on each day. A thicker left edge marks a task starting that day.',
  coverTitle: 'Project Schedule for',
  coverPlaceholder: 'Company / Client Name',
  serviceAddress: 'Service address',
  createdBy: 'Created by',
  preparedFor: 'Prepared for',
}

// Datos de marca WLP para la portada (entregable de cara al cliente).
const BRAND = {
  company: 'We Love Paving Inc.',
  phone: '(888) 530-7283',
  email: 'main@welovepaving.net',
  cslb: 'CSLB #1049649',
  tagline: 'Home of the Paving Panda™ & The Pothole-Free Guarantee™',
}

// ── util ────────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000
function parseYmd(s: string): Date {
  const d = new Date(s.slice(0, 10) + 'T00:00:00')
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS)
}
function fmt(d: Date): string {
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })
}
function fmtYear(d: Date): string {
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtLong(d: Date): string {
  return d.toLocaleDateString(LOCALE, { month: 'long', day: 'numeric', year: 'numeric' })
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ))
}
// #rrggbb -> rgba(r,g,b,a); si no es hex valido devuelve el color tal cual.
function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Layout de impresion (px @96dpi; A4 horizontal util ~ 1040px).
const LEFT = 250
const ROW = 30
const HEADER_H = 34
const MAX_PXDAY = 34
const MIN_PXDAY = 2.2
const TARGET_TIMELINE = 770

const WLP_YELLOW = '#FED500'
const WLP_DARK = '#0A0A0A'

export function exportGanttToPdf(p: GanttExportParams): void {
  const { groups, undated } = p
  const documentTitle = p.documentTitle ?? 'Project Schedule'

  // Ventana de fechas = min inicio .. max fin de todas las tareas con fecha.
  let min: Date | null = null
  let max: Date | null = null
  let taskCount = 0
  for (const g of groups) {
    for (const it of g.items) {
      taskCount++
      const s = parseYmd(it.start)
      const e = parseYmd(it.end)
      if (!min || s < min) min = s
      if (!max || e > max) max = e
    }
  }
  const today = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) })()
  if (!min) min = today
  if (!max) max = addDays(today, 30)
  // Un poco de aire a los lados.
  const windowStart = addDays(min, -2)
  const windowEnd = addDays(max, 2)
  const totalDays = Math.max(daysBetween(windowStart, windowEnd) + 1, 1)
  const pxDay = Math.max(Math.min(TARGET_TIMELINE / totalDays, MAX_PXDAY), MIN_PXDAY)
  const timelineW = totalDays * pxDay
  const totalW = LEFT + timelineW
  const weekPx = 7 * pxDay

  // Ticks semanales (lunes) para el eje.
  const firstMonday = addDays(windowStart, (8 - windowStart.getDay()) % 7)
  const firstMondayOff = daysBetween(windowStart, firstMonday)
  const ticks: { off: number; date: Date }[] = []
  for (let d = firstMonday; d <= windowEnd; d = addDays(d, 7)) {
    ticks.push({ off: daysBetween(windowStart, d), date: d })
  }

  // Banda de meses.
  interface MonthBand { off: number; span: number; label: string }
  const months: MonthBand[] = []
  {
    let cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1)
    while (cur <= windowEnd) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
      const segStart = cur < windowStart ? windowStart : cur
      const segEnd = addDays(next, -1) > windowEnd ? windowEnd : addDays(next, -1)
      const off = daysBetween(windowStart, segStart)
      const span = daysBetween(segStart, segEnd) + 1
      months.push({ off, span, label: cur.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }) })
      cur = next
    }
  }

  const todayOff = daysBetween(windowStart, today)
  const todayInRange = todayOff >= 0 && todayOff < totalDays
  const todayPx = todayOff * pxDay + pxDay / 2

  // ── Barra dentro del carril de una fila ─────────────────────────────────────
  function bar(it: GanttExportTask): string {
    const s = parseYmd(it.start)
    const e = parseYmd(it.end)
    const left = daysBetween(windowStart, s) * pxDay
    const width = Math.max((daysBetween(s, e) + 1) * pxDay, 6)
    const dur = daysBetween(s, e) + 1
    // Barra SOLIDA con el color ya seteado en la app (estado o prioridad), para
    // que la impresion no salga "muerta". Terminadas: relleno tenue rayado.
    const bg = it.done ? '#eef1f5' : rgba(it.color, 0.92)
    const border = it.overdue ? '#dc2626' : rgba(it.color, 1)
    const hatch = it.done
      ? 'background-image:repeating-linear-gradient(45deg,#dbe2ea 0,#dbe2ea 3px,#f4f7fa 3px,#f4f7fa 7px);'
      : ''
    // Duracion a la DERECHA de la barra (fuera del relleno) para no pelear con el
    // color; solo si cabe dentro del carril.
    const fitsRight = left + width + 20 <= timelineW
    const durLabel = fitsRight
      ? `<span class="dur" style="left:${left + width + 4}px;color:${it.done ? '#94a3b8' : rgba(it.color, 1)}">${dur}${T.days}</span>`
      : ''
    return (
      `<div class="bar${it.done ? ' done' : ''}" style="left:${left}px;width:${width}px;background:${bg};border:1px solid ${border};${it.overdue ? 'box-shadow:0 0 0 1.5px #dc2626;' : ''}${hatch}"></div>${durLabel}`
    )
  }

  // ── Fila de tarea (celda izquierda descriptiva + carril con barra) ──────────
  function row(it: GanttExportTask): string {
    const s = parseYmd(it.start)
    const e = parseYmd(it.end)
    const dur = daysBetween(s, e) + 1
    const dateRange = s.getTime() === e.getTime() ? fmt(s) : `${fmt(s)} to ${fmt(e)}`
    const parts: string[] = [
      `<span class="mdate">${esc(dateRange)}</span>`,
      `<span class="mdur">${dur}${T.days}</span>`,
    ]
    if (it.assignee) parts.push(`<span class="masg">${esc(it.assignee)}</span>`)
    if (it.priority && it.priority !== 'none') {
      parts.push(`<span class="mprio">${esc(PRIORITY_EN[it.priority] ?? it.priority)}</span>`)
    }
    if (it.overdue) parts.push(`<span class="movd">${esc(T.overdue)}</span>`)
    const meta = parts.join('<span class="sep">&middot;</span>')
    const projLine = it.project
      ? `<div class="lproj">${esc(it.project)}</div>`
      : ''
    // Pill de fase/etiqueta con su color, para que la fila lea con color y contexto.
    const phasePill = it.label
      ? `<span class="lphase" style="background:${rgba(it.label.color, 0.16)};border-color:${rgba(it.label.color, 0.55)};color:${it.label.color}">${esc(it.label.name)}</span>`
      : ''
    return (
      `<tr class="row">`
      + `<td class="lcell">`
      + `<div class="ltop"><span class="dot" style="background:${it.color}"></span>`
      + `<span class="ltitle${it.done ? ' done' : ''}">${esc(it.title)}</span>${phasePill}</div>`
      + projLine
      + `<div class="lmeta">${meta}</div>`
      + `</td>`
      + `<td class="tl">${bar(it)}${todayInRange ? `<div class="tlnow" style="left:${todayPx}px"></div>` : ''}</td>`
      + `</tr>`
    )
  }

  const bodyHtml = groups.map(g => {
    const name = (g.category && CATEGORY_EN[g.category]) || g.label || ''
    return (
      `<tr class="grow"><td class="gcell" colspan="2">`
      + `<span class="gname">${esc(name)}</span>`
      + `<span class="gcount">${g.items.length}</span>`
      + `</td></tr>`
      + g.items.map(row).join('')
    )
  }).join('')

  const monthBands = months.map(m => (
    `<div class="mon" style="left:${m.off * pxDay}px;width:${m.span * pxDay}px">${esc(m.label)}</div>`
  )).join('')
  const scaleTicks = ticks.map(t => (
    `<div class="tick" style="left:${t.off * pxDay}px"><span>${esc(fmt(t.date))}</span></div>`
  )).join('')
  const axisNow = todayInRange
    ? `<div class="axisnow" style="left:${todayPx}px"><span class="lab">${esc(T.today)}</span></div>`
    : ''

  const undatedHtml = undated.length
    ? `<div class="undated"><div class="uhead">${esc(T.undated)} <span>${undated.length}</span></div>`
      + `<div class="uwrap">` + undated.map(u => (
        `<span class="uchip">${esc(u.title)}${u.project ? `<span class="uproj">${esc(u.project)}</span>` : ''}</span>`
      )).join('') + `</div></div>`
    : ''

  // ── Plan diario: lista de lo que se trabaja cada dia, con color ─────────────
  interface FlatTask { title: string; color: string; start: Date; end: Date; done: boolean; project?: string }
  const flat: FlatTask[] = []
  for (const g of groups) {
    for (const it of g.items) {
      flat.push({
        title: it.title, color: it.color, start: parseYmd(it.start), end: parseYmd(it.end),
        done: it.done, project: it.project,
      })
    }
  }
  let dailyHtml = ''
  if (flat.length > 0) {
    const dMin = min, dMax = max
    const rows: string[] = []
    let curMonthKey = ''
    for (let d = new Date(dMin.getFullYear(), dMin.getMonth(), dMin.getDate()); d <= dMax; d = addDays(d, 1)) {
      const active = flat.filter(f => f.start <= d && d <= f.end)
      if (active.length === 0) continue
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`
      if (monthKey !== curMonthKey) {
        curMonthKey = monthKey
        rows.push(`<div class="dmonth">${esc(d.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }))}</div>`)
      }
      const weekend = d.getDay() === 0 || d.getDay() === 6
      const dayMs = d.getTime()
      const chips = active
        .slice()
        .sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title))
        .map(f => {
          const starts = f.start.getTime() === dayMs
          const bg = f.done ? '#f1f5f9' : rgba(f.color, 0.16)
          const bd = f.done ? '#cbd5e1' : f.color
          const tc = f.done ? '#94a3b8' : f.color
          return `<span class="dchip${starts ? ' starts' : ''}${f.done ? ' done' : ''}" style="background:${bg};border-color:${bd};color:${tc}">${esc(f.title)}${f.project ? `<span class="dproj">${esc(f.project)}</span>` : ''}</span>`
        }).join('')
      const dow = d.toLocaleDateString(LOCALE, { weekday: 'short' })
      const dateLabel = d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })
      rows.push(
        `<div class="drow${weekend ? ' we' : ''}">`
        + `<div class="dday"><span class="ddow">${esc(dow)}</span><span class="ddate">${esc(dateLabel)}</span></div>`
        + `<div class="dchips">${chips}</div></div>`
      )
    }
    dailyHtml = `<div class="daily"><h2>${esc(T.dailyTitle)}</h2><div class="dsub">${esc(T.dailyHint)}</div>${rows.join('')}</div>`
  }

  const generatedAt = fmtLong(today)
  const rangeSummary = taskCount > 0
    ? `${T.tasksWord(taskCount)} &middot; ${esc(fmt(min))} to ${esc(fmtYear(max))}`
    : T.tasksWord(0)

  // ── Portada branded (opcional) ──────────────────────────────────────────────
  // Se antepone una hoja tipo "carta de presentacion" con el panda, el nombre
  // del cliente (editable desde la app), CSLB y datos de contacto de WLP.
  const pandaUrl = p.cover?.pandaUrl
    || (typeof window !== 'undefined' ? window.location.origin + '/paving-panda.png' : '')
  const projectSpan = taskCount > 0 ? `${esc(fmt(min))} to ${esc(fmtYear(max))}` : ''
  const clientName = p.cover?.clientName?.trim() || ''
  const serviceAddr = p.cover?.serviceAddress?.trim() || ''
  const coverHtml = p.cover
    ? `<section class="cover">
        <div class="cvtop">
          <span class="cvmark">WLP</span>
          <span class="cvcslb">${esc(BRAND.cslb)}</span>
        </div>
        <div class="cvmid">
          <div class="cvleft">
            <div class="cvkicker">${esc(BRAND.company)}</div>
            <h1 class="cvtitle">${esc(T.coverTitle)}</h1>
            <div class="cvclient${clientName ? '' : ' ph'}">${clientName ? esc(clientName) : esc(T.coverPlaceholder)}</div>
            ${serviceAddr ? `<div class="cvaddr"><span class="cvlbl">${esc(T.serviceAddress)}</span>${esc(serviceAddr)}</div>` : ''}
            <div class="cvproj">
              <span class="cvpname">${esc(p.title)}</span>
              ${p.subtitle ? `<span class="cvpsub">${esc(p.subtitle)}</span>` : ''}
            </div>
            ${projectSpan ? `<div class="cvspan">${projectSpan}</div>` : ''}
            <div class="cvtag">${esc(BRAND.tagline)}</div>
          </div>
          <div class="cvright">
            ${pandaUrl ? `<img class="cvpanda" src="${esc(pandaUrl)}" alt="Paving Panda"/>` : ''}
          </div>
        </div>
        <div class="cvfoot">
          <div class="cvfblock">
            <span class="cvflbl">${esc(T.preparedFor)}</span>
            <span class="cvfval">${clientName ? esc(clientName) : esc(T.coverPlaceholder)}</span>
          </div>
          <div class="cvfblock cvfright">
            <span class="cvflbl">${esc(T.createdBy)}</span>
            <span class="cvfval">${esc(BRAND.company)}</span>
            <span class="cvfsub">${esc(BRAND.phone)} &middot; ${esc(BRAND.email)}</span>
            <span class="cvfsub">${esc(generatedAt)}</span>
          </div>
        </div>
      </section>`
    : ''

  // Titulo del documento = nombre del archivo que sugiere el navegador al guardar.
  // SIEMPRE en ingles (entregable de cara al cliente). Se prefiere el nombre del
  // cliente, luego el del proyecto. Nunca terminos en espanol tipo "Diagrama de Gantt".
  const nameForFile = clientName || p.title || 'We Love Paving'
  const fileTitle = `${documentTitle} - ${nameForFile}`

  const html =
`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(fileTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm 9mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html,body { margin:0; padding:0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    color: ${WLP_DARK}; background:#fff; font-size:11px; line-height:1.35;
  }
  .doc { width:${Math.max(totalW, 760)}px; }
  /* Cabecera branded */
  .head { display:flex; align-items:stretch; background:${WLP_DARK}; border-radius:10px; overflow:hidden; margin-bottom:12px; }
  .head .accent { width:8px; background:${WLP_YELLOW}; }
  .head .hbody { flex:1; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .head h1 { color:#fff; font-size:19px; margin:0 0 3px; font-weight:700; letter-spacing:-0.01em; }
  .head .sub { color:#cbd0d8; font-size:11px; }
  .head .sub b { color:#fff; font-weight:600; }
  .head .range { color:#9aa1ad; font-size:10px; margin-top:4px; }
  .brand { text-align:right; color:#fff; white-space:nowrap; }
  .brand .mark { display:inline-block; background:${WLP_YELLOW}; color:${WLP_DARK}; font-weight:800; font-size:12px; letter-spacing:0.04em; padding:4px 8px; border-radius:6px; }
  .brand .tag { display:block; margin-top:5px; font-size:9px; letter-spacing:0.18em; text-transform:uppercase; color:#9aa1ad; }
  /* Leyenda */
  .legend { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:8px; font-size:10px; color:#475569; }
  .legend .lg { display:inline-flex; align-items:center; gap:5px; }
  .legend .sw { width:11px; height:11px; border-radius:3px; }
  .legend .swo { width:11px; height:11px; border-radius:3px; box-shadow:0 0 0 1px #dc2626 inset; background:${rgba('#dc2626', 0.15)}; }
  .legend .gen { margin-left:auto; color:#94a3b8; }
  /* Tabla Gantt: thead se repite en cada pagina impresa */
  table.gantt { width:${totalW}px; border-collapse:collapse; table-layout:fixed; }
  table.gantt thead { display:table-header-group; }
  table.gantt th, table.gantt td { padding:0; vertical-align:middle; }
  /* Encabezado: columna izquierda + eje de fechas */
  .lhead { width:${LEFT}px; border-right:1px solid #cbd5e1; border-bottom:1.5px solid #cbd5e1;
    text-align:left; padding:0 8px 5px; vertical-align:bottom; height:${HEADER_H}px;
    font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#64748b; }
  .ahead { width:${timelineW}px; border-bottom:1.5px solid #cbd5e1; padding:0; }
  .axis { position:relative; height:${HEADER_H}px; width:${timelineW}px; }
  .mon { position:absolute; top:0; height:15px; font-size:9px; font-weight:700; text-transform:capitalize;
    color:${WLP_DARK}; border-left:1px solid #cbd5e1; padding-left:4px; line-height:15px; white-space:nowrap; overflow:hidden; }
  .tick { position:absolute; top:16px; height:16px; border-left:1px solid #eef1f5; }
  .tick span { position:absolute; left:3px; top:2px; font-size:8px; color:#64748b; white-space:nowrap; }
  .axisnow { position:absolute; top:0; bottom:0; width:0; border-left:1.5px dashed ${WLP_DARK}; opacity:0.6; }
  .axisnow .lab { position:absolute; top:0; left:2px; font-size:8px; font-weight:700; color:${WLP_DARK};
    background:${WLP_YELLOW}; padding:0 3px; border-radius:3px; }
  /* Grupos */
  .grow { break-inside:avoid; }
  .grow .gcell { background:${rgba(WLP_YELLOW, 0.20)}; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;
    padding:4px 8px; font-size:10px; font-weight:700; }
  .grow .gname { color:${WLP_DARK}; }
  .grow .gcount { color:#64748b; font-weight:600; margin-left:6px; }
  /* Filas de tarea */
  .row { break-inside:avoid; }
  .row td { border-bottom:1px solid #f1f5f9; height:${ROW}px; }
  .lcell { width:${LEFT}px; border-right:1px solid #e2e8f0; padding:3px 8px; }
  .ltop { display:flex; align-items:center; gap:6px; }
  .dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
  .ltitle { flex:1 1 auto; min-width:0; font-size:10.5px; font-weight:600; color:${WLP_DARK}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ltitle.done { color:#94a3b8; text-decoration:line-through; font-weight:500; }
  .lphase { flex:0 0 auto; font-size:8px; font-weight:700; letter-spacing:0.01em; padding:1px 5px;
    border:1px solid; border-radius:9px; white-space:nowrap; max-width:96px; overflow:hidden; text-overflow:ellipsis; }
  .lproj { font-size:8.5px; color:#64748b; margin:1px 0 0 14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lmeta { font-size:8.5px; color:#64748b; margin:2px 0 0 14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lmeta .sep { color:#cbd5e1; margin:0 5px; }
  .lmeta .mdate { color:#334155; font-weight:600; }
  .lmeta .mdur { color:#94a3b8; }
  .lmeta .masg { color:#475569; }
  .lmeta .mprio { color:#475569; }
  .lmeta .movd { color:#dc2626; font-weight:700; }
  /* Carril del Gantt: lineas semanales + sombreado suave de fin de semana */
  .tl { position:relative; width:${timelineW}px; height:${ROW}px;
    background-image:
      repeating-linear-gradient(to right,#eef1f5 0px,#eef1f5 1px,transparent 1px,transparent ${weekPx}px),
      repeating-linear-gradient(to right,transparent 0px,transparent ${5 * pxDay}px,#f6f8fa ${5 * pxDay}px,#f6f8fa ${weekPx}px);
    background-position:${firstMondayOff * pxDay}px 0, ${firstMondayOff * pxDay}px 0; background-repeat:repeat; }
  .tlnow { position:absolute; top:0; bottom:0; width:0; border-left:1px dashed ${rgba(WLP_DARK, 0.45)}; }
  .bar { position:absolute; top:50%; transform:translateY(-50%); height:15px; border-radius:4px; overflow:hidden;
    box-shadow:0 1px 1.5px rgba(15,23,42,0.14); }
  .dur { position:absolute; top:50%; transform:translateY(-50%); font-size:8px; font-weight:700; white-space:nowrap; }
  /* Plan diario (segunda seccion, arranca en pagina nueva) */
  .daily { break-before:page; padding-top:2px; }
  .daily h2 { font-size:15px; font-weight:800; color:${WLP_DARK}; margin:0 0 2px; letter-spacing:-0.01em; }
  .daily .dsub { font-size:10px; color:#64748b; margin-bottom:8px; }
  .dmonth { font-size:11px; font-weight:800; text-transform:capitalize; color:${WLP_DARK};
    background:${rgba(WLP_YELLOW, 0.20)}; padding:4px 8px; border-radius:4px; margin:12px 0 6px; break-after:avoid; }
  .drow { display:flex; gap:10px; padding:5px 2px; border-bottom:1px solid #f1f5f9; break-inside:avoid; align-items:baseline; }
  .drow.we { background:#fafbfc; }
  .dday { width:74px; flex:0 0 74px; }
  .dday .ddow { font-size:8.5px; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; display:block; }
  .dday .ddate { font-size:11px; font-weight:700; color:${WLP_DARK}; }
  .dchips { flex:1; display:flex; flex-wrap:wrap; gap:4px; }
  .dchip { font-size:9px; border:1px solid; border-left-width:1px; border-radius:4px; padding:1px 6px; line-height:1.55; white-space:nowrap; }
  .dchip.starts { border-left-width:3px; font-weight:600; }
  .dchip.done { text-decoration:line-through; }
  .dchip .dproj { color:#94a3b8; margin-left:5px; font-weight:400; }
  /* Sin fechas */
  .undated { margin-top:12px; border-top:1px solid #e2e8f0; padding-top:8px; break-inside:avoid; }
  .uhead { font-size:10px; font-weight:700; color:#64748b; margin-bottom:6px; }
  .uhead span { color:#94a3b8; font-weight:600; }
  .uwrap { display:flex; flex-wrap:wrap; gap:5px; }
  .uchip { font-size:9px; border:1px solid #e2e8f0; border-radius:5px; padding:2px 6px; color:${WLP_DARK}; }
  .uchip .uproj { color:#94a3b8; margin-left:5px; }
  .foot { margin-top:14px; padding-top:8px; border-top:1px solid #e2e8f0; font-size:8.5px; color:#94a3b8; display:flex; justify-content:space-between; }
  /* Portada branded (hoja 1, entregable de cara al cliente) */
  .cover { break-after:page; width:${Math.max(totalW, 760)}px; min-height:188mm;
    display:flex; flex-direction:column; background:${WLP_DARK}; border-radius:14px; overflow:hidden;
    color:#fff; position:relative; }
  .cover::before { content:''; position:absolute; left:0; top:0; bottom:0; width:10px; background:${WLP_YELLOW}; }
  .cvtop { display:flex; align-items:center; justify-content:space-between; padding:20px 30px 0 40px; }
  .cvmark { background:${WLP_YELLOW}; color:${WLP_DARK}; font-weight:800; font-size:20px; letter-spacing:0.06em; padding:7px 14px; border-radius:8px; }
  .cvcslb { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#9aa1ad; }
  .cvmid { flex:1; display:flex; align-items:center; gap:20px; padding:24px 30px 24px 40px; }
  .cvleft { flex:1; min-width:0; }
  .cvkicker { font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:${WLP_YELLOW}; font-weight:700; margin-bottom:14px; }
  .cvtitle { font-size:34px; line-height:1.05; font-weight:800; margin:0 0 16px; letter-spacing:-0.02em; color:#fff; }
  .cvclient { font-size:26px; font-weight:700; color:#fff; padding-bottom:8px; margin-bottom:18px;
    border-bottom:2px dashed rgba(255,255,255,0.35); display:inline-block; min-width:60%; }
  .cvclient.ph { color:#6b7280; font-weight:600; font-style:italic; }
  .cvaddr { font-size:12px; color:#cbd0d8; margin:0 0 18px; }
  .cvaddr .cvlbl { display:block; font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:#7d8593; margin-bottom:2px; }
  .cvproj { margin-bottom:6px; }
  .cvproj .cvpname { font-size:15px; font-weight:700; color:#fff; }
  .cvproj .cvpsub { font-size:12px; color:#9aa1ad; margin-left:8px; }
  .cvspan { font-size:12px; color:${WLP_YELLOW}; font-weight:600; margin-bottom:22px; }
  .cvtag { font-size:12px; font-weight:700; color:${WLP_DARK}; background:${WLP_YELLOW};
    display:inline-block; padding:7px 14px; border-radius:20px; }
  .cvright { flex:0 0 300px; display:flex; align-items:center; justify-content:center; }
  .cvpanda { max-width:300px; max-height:340px; width:auto; height:auto; object-fit:contain; }
  .cvfoot { display:flex; justify-content:space-between; align-items:flex-end; gap:20px;
    padding:16px 40px 22px; border-top:1px solid rgba(255,255,255,0.12); }
  .cvfblock { display:flex; flex-direction:column; }
  .cvfright { text-align:right; }
  .cvflbl { font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:#7d8593; margin-bottom:3px; }
  .cvfval { font-size:13px; font-weight:700; color:#fff; }
  .cvfsub { font-size:10px; color:#9aa1ad; margin-top:2px; }
</style>
</head>
<body>
  <div class="doc">
    ${coverHtml}
    <div class="head">
      <div class="accent"></div>
      <div class="hbody">
        <div>
          <h1>${esc(documentTitle)}</h1>
          <div class="sub"><b>${esc(p.title)}</b>${p.subtitle ? ` &middot; ${esc(p.subtitle)}` : ''}</div>
          <div class="range">${rangeSummary}</div>
        </div>
        <div class="brand">
          <span class="mark">WLP</span>
          <span class="tag">We Love Paving</span>
        </div>
      </div>
    </div>

    <div class="legend">
      <span class="lg"><span class="sw" style="background:${rgba('#ef4444', 0.85)}"></span>${esc(T.priorities.urgent)}</span>
      <span class="lg"><span class="sw" style="background:${rgba('#f97316', 0.85)}"></span>${esc(T.priorities.high)}</span>
      <span class="lg"><span class="sw" style="background:${rgba('#eab308', 0.85)}"></span>${esc(T.priorities.medium)}</span>
      <span class="lg"><span class="sw" style="background:${rgba('#3b82f6', 0.85)}"></span>${esc(T.priorities.low)}</span>
      <span class="lg"><span class="swo"></span>${esc(T.overdue)}</span>
      <span class="gen">${esc(T.generated)}: ${esc(generatedAt)}</span>
    </div>

    <table class="gantt">
      <colgroup><col style="width:${LEFT}px"/><col style="width:${timelineW}px"/></colgroup>
      <thead>
        <tr>
          <th class="lhead">${esc(T.scope)}</th>
          <th class="ahead">
            <div class="axis">
              ${monthBands}
              ${scaleTicks}
              ${axisNow}
            </div>
          </th>
        </tr>
      </thead>
      <tbody>
        ${bodyHtml}
      </tbody>
    </table>

    ${dailyHtml}

    ${undatedHtml}

    <div class="foot">
      <span>${esc(T.footer)}</span>
      <span>${esc(p.subtitle ?? p.title)} &middot; WLO</span>
    </div>
  </div>
  <script>
    (function(){
      var printed=false;
      function go(){ if(printed) return; printed=true; setTimeout(function(){window.print()},120); }
      // Espera a que TODAS las imagenes (el panda de la portada) esten cargadas
      // antes de imprimir, si no la portada sale sin la mascota.
      window.onload=function(){
        var imgs=Array.prototype.slice.call(document.images||[]);
        var pending=imgs.filter(function(im){return !im.complete;});
        if(pending.length===0){ go(); return; }
        var left=pending.length;
        pending.forEach(function(im){
          function done(){ if(--left<=0) go(); }
          im.addEventListener('load',done); im.addEventListener('error',done);
        });
        // Fallback duro por si alguna imagen nunca dispara evento.
        setTimeout(go,2500);
      };
    })();
  </script>
</body>
</html>`

  // Nota: NO usar 'noopener'/'noreferrer' aqui. Con esas banderas window.open
  // devuelve null y no se puede escribir el documento (la pestaña queda en blanco).
  const win = window.open('', '_blank')
  if (!win) {
    console.warn('[gantt-export] window.open bloqueado por el navegador')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  // Forzar el titulo en ingles: algunos navegadores recuerdan el nombre de archivo
  // anterior por URL (about:blank), asi que lo fijamos de nuevo tras escribir el doc.
  try { win.document.title = fileTitle } catch { /* noop */ }
}
