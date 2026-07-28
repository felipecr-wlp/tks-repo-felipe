'use client'

/**
 * Selector de idioma ES / EN para el sidebar.
 *
 * Toggle compacto de dos segmentos. En modo colapsado muestra solo el codigo
 * del idioma activo y alterna al hacer clic. Usa el LanguageProvider.
 */
import { Languages } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n/LanguageProvider'
import type { Lang } from '@/lib/i18n/translations'

export function LanguageSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { lang, setLang, t } = useI18n()

  if (collapsed) {
    return (
      <button
        onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
        title={t('nav.language')}
        className="w-full flex items-center justify-center px-2 py-1.5 rounded-md text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label={t('nav.language')}
      >
        {lang.toUpperCase()}
      </button>
    )
  }

  const options: Lang[] = ['es', 'en']
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <Languages size={14} className="text-muted-foreground/70 flex-shrink-0" />
      <div className="flex-1 inline-flex items-center rounded-md border border-border overflow-hidden">
        {options.map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            className={cn(
              'flex-1 px-2 py-1 text-xs transition-colors',
              lang === l
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}
