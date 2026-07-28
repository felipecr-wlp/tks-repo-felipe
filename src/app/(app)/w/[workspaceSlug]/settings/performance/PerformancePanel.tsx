'use client'

/**
 * Panel de Rendimiento (cliente). Selector de mes (prev/next via query param) +
 * tabla de scores por persona y desglose por canal/proyecto atribuido al manager.
 * Todo el cómputo vive en el server component; aquí solo se pinta y navega.
 */
import Link from 'next/link'
import Image from 'next/image'
import { getInitials } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Trophy, Info, FolderKanban } from 'lucide-react'
import { useI18n } from '@/lib/i18n/LanguageProvider'
import type { PersonScore, ChannelRow } from './page'

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600'
  if (score >= 60) return 'text-amber-600'
  if (score >= 40) return 'text-orange-600'
  return 'text-red-600'
}

function Avatar({ name, url, size = 32 }: { name: string; url: string | null; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-full overflow-hidden bg-muted"
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image src={url} alt={name} width={size} height={size} className="w-full h-full object-cover" />
      ) : (
        <span className="flex items-center justify-center w-full h-full text-xs font-medium text-muted-foreground">
          {getInitials(name)}
        </span>
      )}
    </div>
  )
}

export function PerformancePanel({
  workspaceSlug,
  month,
  people,
  channels,
  totalDone,
}: {
  workspaceSlug: string
  month: string
  people: PersonScore[]
  channels: ChannelRow[]
  totalDone: number
}) {
  const { t, lang } = useI18n()
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const base = `/w/${workspaceSlug}/settings/performance`
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  const activeChannels = channels.filter((c) => c.tasksDone > 0)

  return (
    <div className="space-y-6">
      {/* Cabecera + selector de mes */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('perf.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {totalDone} {totalDone === 1 ? t('perf.closedOne') : t('perf.closedMany')} {t('perf.closedSuffix')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`${base}?month=${prev}`}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t('perf.prevMonth')}
          >
            <ChevronLeft size={16} />
          </Link>
          <span className="px-3 py-1.5 text-sm font-medium capitalize min-w-[9rem] text-center">
            {monthLabel(month, locale)}
          </span>
          <Link
            href={`${base}?month=${next}`}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t('perf.nextMonth')}
          >
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>

      {/* Cómo se calcula */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <p>
          {t('perf.formulaPrefix')} <strong>{t('perf.throughput')}</strong> {t('perf.throughputNote')}{' '}
          <strong>{t('perf.velocity')}</strong> {t('perf.velocityNote')} <strong>{t('perf.ontime')}</strong> {t('perf.ontimeNote')}{' '}
          <strong>{t('perf.estimation')}</strong> {t('perf.formulaSuffix')}
        </p>
      </div>

      {/* Tabla de personas */}
      <section aria-label={t('perf.ariaByPerson')}>
        <h3 className="text-sm font-semibold text-foreground mb-2">{t('perf.byPerson')}</h3>
        {people.length === 0 ? (
          <div className="bg-card border border-border rounded-xl px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t('perf.noClosedPrefix')} {monthLabel(month, locale)}.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('perf.noClosedHint')}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">{t('perf.colPerson')}</th>
                    <th className="px-4 py-2 font-medium text-right">{t('perf.colTasks')}</th>
                    <th className="px-4 py-2 font-medium text-right">{t('perf.colPoints')}</th>
                    <th className="px-4 py-2 font-medium text-right">{t('perf.colOntime')}</th>
                    <th className="px-4 py-2 font-medium text-right">{t('perf.colEstim')}</th>
                    <th className="px-4 py-2 font-medium text-right">{t('perf.colScore')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {people.map((p, i) => (
                    <tr key={p.profileId} className="hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {i === 0 ? <Trophy size={15} className="text-amber-500" /> : i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={p.name} url={p.avatarUrl} />
                          <span className="font-medium text-foreground truncate">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{p.throughput}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{p.velocity}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {p.onTimePct != null ? `${p.onTimePct}%` : '-'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {p.estAccuracy != null ? `${p.estAccuracy}%` : '-'}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${scoreColor(p.score)}`}>
                        {p.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Desglose por canal/proyecto */}
      <section aria-label={t('perf.ariaByChannel')}>
        <h3 className="text-sm font-semibold text-foreground mb-2">{t('perf.byChannel')}</h3>
        <p className="text-xs text-muted-foreground mb-2">
          {t('perf.byChannelDesc')}
        </p>
        {activeChannels.length === 0 ? (
          <div className="bg-card border border-border rounded-xl px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t('perf.noChannelActivity')}</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
            {activeChannels.map((c) => (
              <div key={c.projectId} className="px-4 py-3 flex items-center gap-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-base text-muted-foreground">
                  {c.icon ?? <FolderKanban size={16} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.projectName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.teamName ? `${c.teamName} · ` : ''}
                    {c.managerName ? (
                      <span className="inline-flex items-center gap-1 align-middle">
                        <Avatar name={c.managerName} url={c.managerAvatar} size={16} />
                        {c.managerName}
                      </span>
                    ) : (
                      t('perf.noManager')
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-foreground tabular-nums">{c.tasksDone}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{c.storyPoints} {t('perf.pts')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
