'use client'

/**
 * Grafico semanal (horas por dia) del timesheet, extraido a su propio modulo
 * para que recharts (pesado) NO viaje en el bundle inicial del timesheet. El
 * padre lo carga con next/dynamic({ ssr: false }); asi el codigo de charts solo
 * baja cuando el usuario entra a la vista. Mismo render que antes: mismos datos,
 * colores y tamano de contenedor.
 */
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts'

export interface WeeklyHours { label: string; horas: number }

export default function WeeklyHoursChart({ data }: { data: WeeklyHours[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
          formatter={(v: number) => [`${v} h`, 'Horas']}
        />
        <Bar dataKey="horas" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  )
}
