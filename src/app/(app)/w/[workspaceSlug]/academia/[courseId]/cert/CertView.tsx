'use client'

/* Vista del certificado. Emite (si faltaba) y muestra el diploma imprimible.
   La impresion usa window.print(); el CSS @media print oculta la navegacion. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Award, ArrowLeft, Printer, Lock } from 'lucide-react'
import type { AcademyCertificate } from '@/lib/academy/types'

export function CertView({
  courseId,
  courseTitle,
  certName,
  accent,
  recipientName,
  allDone,
  backHref,
  existingCert,
}: {
  courseId: string
  courseTitle: string
  certName: string
  accent: string
  recipientName: string
  allDone: boolean
  backHref: string
  existingCert: AcademyCertificate | null
}) {
  const router = useRouter()
  const [cert, setCert] = useState<AcademyCertificate | null>(existingCert)
  const [busy, setBusy] = useState(false)

  async function issue() {
    setBusy(true)
    try {
      const res = await fetch('/api/academy/certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'No se pudo emitir')
      setCert(j.certificate)
      toast.success('¡Certificado emitido!')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  if (!cert && !allDone) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
        <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-bold text-foreground">Aún no puedes certificarte</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Completa todos los módulos del curso para obtener tu certificado.
        </p>
        <Link
          href={backHref}
          className="mt-5 inline-flex items-center gap-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" /> Volver al curso
        </Link>
      </div>
    )
  }

  if (!cert) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-16 text-center">
        <Award className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
        <h1 className="text-xl font-bold text-foreground">¡Completaste {courseTitle}!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Emite tu certificado oficial. Podrás imprimirlo o guardarlo en PDF.
        </p>
        <button
          onClick={issue}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          <Award className="h-4 w-4" /> {busy ? 'Emitiendo...' : 'Emitir certificado'}
        </button>
      </div>
    )
  }

  const issuedDate = new Date(cert.issued_at).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver al curso
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Printer className="h-4 w-4" /> Imprimir / PDF
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-2xl border-4 bg-white p-10 text-center shadow-sm print:border-2 print:shadow-none"
        style={{ borderColor: accent }}
      >
        <div className="mb-6 flex items-center justify-center gap-2">
          <Award className="h-8 w-8" style={{ color: accent }} />
          <span className="text-lg font-bold tracking-tight text-neutral-900">We Love Paving</span>
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
          Certificado de finalización
        </p>
        <p className="mt-6 text-sm text-neutral-500">Se otorga a</p>
        <h1 className="mt-1 text-3xl font-bold text-neutral-900">{recipientName}</h1>
        <p className="mt-6 text-sm text-neutral-500">por completar satisfactoriamente el curso</p>
        <h2 className="mt-1 text-xl font-semibold" style={{ color: accent }}>
          {certName}
        </h2>
        <div className="mt-8 flex items-center justify-center gap-8 text-sm text-neutral-600">
          <div>
            <p className="font-semibold text-neutral-900">{cert.score}%</p>
            <p className="text-xs text-neutral-500">Calificación</p>
          </div>
          <div>
            <p className="font-semibold text-neutral-900">{issuedDate}</p>
            <p className="text-xs text-neutral-500">Fecha</p>
          </div>
        </div>
        <p className="mt-8 font-mono text-[11px] tracking-wide text-neutral-400">{cert.code}</p>
      </div>
    </div>
  )
}
