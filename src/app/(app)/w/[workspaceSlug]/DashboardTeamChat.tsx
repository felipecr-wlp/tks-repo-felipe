'use client'

/**
 * DashboardTeamChat, chat general por equipo embebido en el panel general
 * del workspace. Si el usuario pertenece a varios equipos, muestra pestañas
 * para cambiar entre ellos; cada cambio remonta el TeamChat (key=team.id)
 * para reiniciar su suscripción realtime y su estado local.
 */
import { useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TeamChat } from '@/components/chat/TeamChat'
import { useT } from '@/lib/i18n/LanguageProvider'

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface Message {
  id: string
  author_id: string
  body: string
  created_at: string
}

export interface TeamChatData {
  id: string
  name: string
  slug: string
  members: Member[]
  initialMessages: Message[]
}

interface DashboardTeamChatProps {
  workspaceSlug: string
  currentUserId: string
  teams: TeamChatData[]
}

export function DashboardTeamChat({ workspaceSlug, currentUserId, teams }: DashboardTeamChatProps) {
  const tr = useT()
  const [activeId, setActiveId] = useState(teams[0]?.id ?? '')

  if (teams.length === 0) return null

  const active = teams.find(t => t.id === activeId) ?? teams[0]

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          {tr('dash.teamChat')}
        </h2>
        <Link
          href={`/w/${workspaceSlug}/t/${active.slug}/chat`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={tr('dash.openFullChat')}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Link>
      </div>

      {teams.length > 1 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {teams.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                t.id === active.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col bg-card border border-border rounded-xl overflow-hidden h-[460px]">
        <TeamChat
          key={active.id}
          teamId={active.id}
          currentUserId={currentUserId}
          members={active.members}
          initialMessages={active.initialMessages}
        />
      </div>
    </section>
  )
}
