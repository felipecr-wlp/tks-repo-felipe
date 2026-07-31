'use client'

/**
 * La cuadrícula de accesos. Una fila por persona, una columna por departamento,
 * un clic para mover a alguien. Sin roles, sin niveles, sin herencias que
 * configurar: en este sistema pertenecer al departamento ES el permiso.
 *
 * La columna de la derecha es la que lo vuelve útil a diario: dice cuántos
 * documentos alcanza esa persona AHORA. Si alguien dice "no veo nada", se mira
 * su fila y se entiende en dos segundos por qué.
 */
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Globe, Lock, Search, ShieldCheck, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AccessSpace {
  id: string
  name: string
  is_restricted: boolean
}

export interface AccessPerson {
  id: string
  name: string
  email: string
  avatar_url: string | null
  isOrgAdmin: boolean
  spaceIds: string[]
  notesSeen: number
  boardsSeen: number
}

interface Props {
  people: AccessPerson[]
  spaces: AccessSpace[]
  totalNotes: number
  totalBoards: number
  workspaceSlug: string
}

export function AccessMatrix({ people, spaces, totalNotes, totalBoards }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()
  // Cambios en vuelo, para que el punto responda al instante y no parezca trabado.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [busyCell, setBusyCell] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(p =>
      p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
    )
  }, [people, query])

  const belongs = (person: AccessPerson, spaceId: string): boolean => {
    const key = `${person.id}:${spaceId}`
    if (key in optimistic) return optimistic[key]
    return person.spaceIds.includes(spaceId)
  }

  async function toggle(person: AccessPerson, space: AccessSpace) {
    const key = `${person.id}:${space.id}`
    const wasIn = belongs(person, space.id)
    setOptimistic(o => ({ ...o, [key]: !wasIn }))
    setBusyCell(key)
    try {
      const res = wasIn
        ? await fetch(`/api/spaces/${space.id}/members/${person.id}`, { method: 'DELETE' })
        : await fetch(`/api/spaces/${space.id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_id: person.id }),
          })
      if (!res.ok) throw new Error()
      toast.success(
        wasIn
          ? `${person.name} sale de ${space.name}`
          : `${person.name} entra a ${space.name}`
      )
      // Se recarga del servidor para que los conteos de "qué ve" digan la verdad.
      startTransition(() => router.refresh())
    } catch {
      setOptimistic(o => {
        const next = { ...o }
        delete next[key]
        return next
      })
      toast.error('No se pudo cambiar el acceso')
    } finally {
      setBusyCell(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Encabezado y la regla completa, en tres frases */}
      <div>
        <h2 className="text-lg font-semibold text-foreground tracking-tight">Accesos</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Quién ve qué. Se controla en un solo lugar y con una sola palanca:
          el departamento al que pertenece cada persona.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <RuleCard
          icon={<Lock className="w-3.5 h-3.5" />}
          title="Privado"
          body="Todo documento nace privado de quien lo crea. Nadie más lo ve."
        />
        <RuleCard
          icon={<Users className="w-3.5 h-3.5" />}
          title="Departamento"
          body="Compartir significa el departamento del autor, no la empresa entera."
        />
        <RuleCard
          icon={<Globe className="w-3.5 h-3.5" />}
          title="Toda la empresa"
          body="Existe, pero solo lo abre quien puede publicar comunicados."
        />
      </div>

      {/* Buscador */}
      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar persona"
          className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {spaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay departamentos. Créalos en la pestaña Departamentos y aquí
          podrás repartir a la gente.
        </p>
      ) : (
        <div className={cn(
          'overflow-x-auto rounded-lg border border-border bg-card transition-opacity',
          pending && 'opacity-60'
        )}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card text-left font-medium text-xs uppercase tracking-wide text-muted-foreground px-4 py-3 min-w-[220px]">
                  Persona
                </th>
                {spaces.map(s => (
                  <th
                    key={s.id}
                    className="px-2 py-3 text-center font-medium text-xs text-muted-foreground min-w-[92px]"
                    title={s.is_restricted
                      ? `${s.name} es restringido: solo sus miembros ven su contenido`
                      : s.name}
                  >
                    <span className="inline-flex items-center gap-1 justify-center">
                      {s.is_restricted && <Lock className="w-3 h-3 flex-shrink-0" />}
                      <span className="truncate max-w-[90px]">{s.name}</span>
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-right font-medium text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  Alcanza a ver
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="sticky left-0 z-10 bg-card px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={p.name} url={p.avatar_url} />
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate flex items-center gap-1.5">
                          {p.name}
                          {p.isOrgAdmin && (
                            <span
                              title="Administra la organización: ve todo por definición"
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium"
                            >
                              <ShieldCheck className="w-2.5 h-2.5" />
                              Admin
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">{p.email}</p>
                      </div>
                    </div>
                  </td>

                  {spaces.map(s => {
                    const on = belongs(p, s.id)
                    const key = `${p.id}:${s.id}`
                    return (
                      <td key={s.id} className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => toggle(p, s)}
                          disabled={busyCell === key}
                          title={on
                            ? `Quitar a ${p.name} de ${s.name}`
                            : `Agregar a ${p.name} a ${s.name}`}
                          className={cn(
                            'w-6 h-6 rounded-md border inline-flex items-center justify-center transition-all disabled:opacity-40',
                            on
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-border text-transparent hover:border-primary/60 hover:bg-accent'
                          )}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )
                  })}

                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <span className="text-sm text-foreground tabular-nums">
                      {p.notesSeen}
                      <span className="text-muted-foreground"> / {totalNotes}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground block">
                      documentos · {p.boardsSeen} de {totalBoards} pizarras
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={spaces.length + 2} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nadie coincide con esa búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Un clic en la cuadrícula mueve a la persona de departamento al instante y
        el número de la derecha se recalcula solo. Los documentos privados de cada
        quien siguen siendo suyos: entrar a un departamento no los abre.
      </p>
    </div>
  )
}

function RuleCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{body}</p>
    </div>
  )
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
  }
  const initials = name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
  return (
    <span className="w-7 h-7 rounded-full bg-muted text-muted-foreground text-[11px] font-medium inline-flex items-center justify-center flex-shrink-0">
      {initials}
    </span>
  )
}
