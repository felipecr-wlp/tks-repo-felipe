'use client'

/* Quiz de un modulo. El usuario elige una opcion por pregunta, califica, y si
   aprueba (>=70%) se guarda el progreso via /api/academy/progress. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, ArrowRight } from 'lucide-react'
import type { QuizQuestion } from '@/lib/academy/types'

const PASS = 70

export function ModuleQuiz({
  courseId,
  moduleId,
  quiz,
  accent,
  alreadyPassed,
  nextHref,
  nextLabel,
}: {
  courseId: string
  moduleId: string
  quiz: QuizQuestion[]
  accent: string
  alreadyPassed: boolean
  nextHref: string
  nextLabel: string
}) {
  const router = useRouter()
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [graded, setGraded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [passed, setPassed] = useState(alreadyPassed)

  if (!quiz || quiz.length === 0) {
    return (
      <div className="mt-10 border-t border-border pt-6">
        <Link
          href={nextHref}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          {nextLabel} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    )
  }

  const score = Math.round(
    (quiz.filter((q, i) => answers[i] === q.a).length / quiz.length) * 100,
  )

  async function grade() {
    if (Object.keys(answers).length < quiz.length) {
      toast.error('Responde todas las preguntas')
      return
    }
    setGraded(true)
    const didPass = score >= PASS
    if (didPass && !passed) {
      setSaving(true)
      try {
        const res = await fetch('/api/academy/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, moduleId, score }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || 'No se pudo guardar')
        }
        setPassed(true)
        toast.success('¡Módulo aprobado!')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Error al guardar')
      } finally {
        setSaving(false)
      }
    }
  }

  function reset() {
    setAnswers({})
    setGraded(false)
  }

  return (
    <div className="mt-10 border-t border-border pt-6">
      <h2 className="mb-4 text-lg font-semibold text-foreground">Evaluación</h2>

      {alreadyPassed && !graded && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm font-medium text-emerald-500">
          <CheckCircle2 className="h-4 w-4" /> Ya aprobaste este módulo. Puedes repasarlo.
        </div>
      )}

      <div className="space-y-5">
        {quiz.map((q, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 font-medium text-foreground">
              {i + 1}. {q.q}
            </p>
            <div className="space-y-2">
              {q.opts.map((opt, j) => {
                const selected = answers[i] === j
                const isCorrect = j === q.a
                let cls = 'border-border hover:bg-muted'
                if (graded) {
                  if (isCorrect) cls = 'border-emerald-500 bg-emerald-500/10'
                  else if (selected) cls = 'border-red-500 bg-red-500/10'
                  else cls = 'border-border opacity-60'
                } else if (selected) {
                  cls = 'border-primary bg-primary/10'
                }
                return (
                  <button
                    key={j}
                    disabled={graded}
                    onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm text-foreground transition ${cls}`}
                  >
                    {graded && isCorrect && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    {graded && selected && !isCorrect && (
                      <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    )}
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>
            {graded && q.ex && (
              <p className="mt-2 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
                {q.ex}
              </p>
            )}
          </div>
        ))}
      </div>

      {!graded ? (
        <button
          onClick={grade}
          className="mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          Calificar
        </button>
      ) : (
        <div className="mt-5 space-y-3">
          <div
            className={`rounded-xl p-4 text-center ${
              score >= PASS ? 'bg-emerald-500/10' : 'bg-red-500/10'
            }`}
          >
            <p className="text-2xl font-bold text-foreground">{score}%</p>
            <p className={`text-sm font-medium ${score >= PASS ? 'text-emerald-500' : 'text-red-500'}`}>
              {score >= PASS ? 'Aprobado' : `Necesitas ${PASS}% para aprobar`}
            </p>
          </div>
          {score >= PASS ? (
            <Link
              href={nextHref}
              className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              {saving ? 'Guardando...' : nextLabel} <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <button
              onClick={reset}
              className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Intentar de nuevo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
