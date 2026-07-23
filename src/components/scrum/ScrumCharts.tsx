'use client'

/**
 * Graficas de recharts del ScrumWorkspace, extraidas a su propio modulo para que
 * recharts (pesado) NO viaje en el bundle inicial. El padre las carga con
 * next/dynamic({ ssr: false }), asi el codigo de charts solo baja cuando el
 * usuario abre la vista Dashboard. No cambia nada visual ni de comportamiento:
 * mismos datos, mismos colores, mismos tamanos de contenedor.
 *
 * Cada variante corresponde a una de las subarboles <ResponsiveContainer> que
 * antes vivian inline en ScrumWorkspace.tsx (paneles de sprint y de flujo).
 */
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  CartesianGrid, Legend,
} from 'recharts'

// Copiados verbatim de ScrumWorkspace para mantener identico el render.
const AREA_COLORS = ['#FED500', '#6366f1', '#10b981', '#f97316', '#ec4899', '#06b6d4', '#a855f7', '#84cc16']

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--card))',
  fontSize: 12,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
} as const

interface NameValue { name: string; value: number }
interface PersonSP { name: string; committed: number; done: number }
interface PersonTasks { name: string; activas: number; hechas: number }

export type ScrumChartProps =
  | { variant: 'areaPie'; data: NameValue[]; height?: number }
  | { variant: 'personSP'; data: PersonSP[]; height?: number }
  | { variant: 'flowBars'; data: NameValue[]; height?: number }
  | { variant: 'personTasks'; data: PersonTasks[]; height?: number }

// Dona de mix por area (story points o tareas). Usada en sprint y en flujo.
function AreaPie({ data, height = 240 }: { data: NameValue[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={86} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
          {data.map((_, i) => <Cell key={i} fill={AREA_COLORS[i % AREA_COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

// Barras de carga por persona en el panel de SPRINT (comprometido vs hecho, SP).
function PersonSPBars({ data, height = 240 }: { data: PersonSP[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="committed" name="Comprometido" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={40} />
        <Bar dataKey="done" name="Hecho" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Barras de distribucion por columna en el panel de FLUJO (una barra por estado).
function FlowBars({ data, height = 220 }: { data: NameValue[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
        <Bar dataKey="value" name="Tareas" radius={[6, 6, 0, 0]} maxBarSize={64}>
          {data.map((_, i) => <Cell key={i} fill={AREA_COLORS[i % AREA_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Barras de carga por persona en el panel de FLUJO (en curso vs hechas, tareas).
function PersonTasksBars({ data, height = 220 }: { data: PersonTasks[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="activas" name="En curso" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={40} />
        <Bar dataKey="hechas" name="Hechas" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Despachador unico: el padre importa este default via next/dynamic y elige la
// variante. Cada rama replica exactamente el subarbol que estaba inline.
export default function ScrumChart(props: ScrumChartProps) {
  switch (props.variant) {
    case 'areaPie': return <AreaPie data={props.data} height={props.height} />
    case 'personSP': return <PersonSPBars data={props.data} height={props.height} />
    case 'flowBars': return <FlowBars data={props.data} height={props.height} />
    case 'personTasks': return <PersonTasksBars data={props.data} height={props.height} />
  }
}
