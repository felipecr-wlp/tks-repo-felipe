'use client'

/**
 * Publicar una herramienta: la pantalla completa.
 *
 * Antes esto era un dialogo. Un dialogo esta bien para confirmar algo y muy mal
 * para lo que en realidad es esto: llenar ocho campos, entender que significa
 * cada permiso y comprobar que tu deploy responde. En un recuadro de 500px eso
 * se hace con scroll dentro de scroll y con la mitad del contexto tapado.
 *
 * Tres cosas que esta version hace y la anterior no:
 *
 *   1. COMPROBAR LA URL antes de enviarla. Las tres formas de "no carga" (no
 *      responde, redirige al login del hosting, se niega a ser enmarcada) son
 *      invisibles desde un formulario y se descubrian dias despues mirando un
 *      recuadro en blanco. Ahora se ven al teclear.
 *   2. Decir en voz alta que pasa DESPUES de enviar, al lado del boton, no en
 *      un parrafo que nadie lee. Quien propone se queda esperando algo que no
 *      va a pasar solo.
 *   3. Separar en pasos numerados. No es cosmetico: el orden es donde vive,
 *      como se usa, que permisos pide. Cada uno tiene una decision distinta.
 *
 * Lo que NO cambio, porque es la parte que importa: marcar un permiso aqui no
 * concede nada. Nace en borrador, no se lista, no se instala. El servidor lo
 * hace cumplir; este formulario solo lo dice.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, CheckCircle2, Loader2, ShieldAlert, XCircle, Globe, Puzzle, KeyRound, Send,
} from 'lucide-react'
import { SCOPE_CATALOG } from '@/lib/connectors/scopes'
import { RE_APP_ID } from '@/lib/validation'
import type { Veredicto } from '@/lib/connectors/comprobar-url'

const RIESGO: Record<string, string> = {
  bajo: 'bg-muted text-muted-foreground',
  medio: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  alto: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

const APP_TITULO: Record<string, string> = {
  wli: 'WLI Marketing OS',
  wlo: 'WLO Workspace',
  wlm: 'WLM Measure',
}

/**
 * Marcas diacriticas de Unicode (U+0300 a U+036F), las que deja sueltas
 * `normalize('NFD')` al separar "ñ" en "n" + tilde. Se arma con fromCharCode y
 * no con el rango escrito en el literal porque esos caracteres son INVISIBLES
 * en el editor: cualquiera los tomaria por basura y los borraria "limpiando".
 */
const COMBINANTES = new RegExp(
  '[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']',
  'g',
)

/** Nombre visible -> identificador. Se sugiere; sigue siendo editable a mano. */
function sugerirId(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(COMBINANTES, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39)
}

function Paso({
  numero, icono, titulo, sub, children,
}: {
  numero: number
  icono: React.ReactNode
  titulo: string
  sub: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icono}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            <span className="text-muted-foreground">{numero}.</span> {titulo}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{sub}</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

const claseCampo =
  'mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition'

export function PublicarHerramientaForm({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTocado, setIdTocado] = useState(false)
  const [description, setDescription] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://')
  const [kind, setKind] = useState<'connector' | 'embed'>('embed')
  const [embedPath, setEmbedPath] = useState('/embed')
  const [scopes, setScopes] = useState<string[]>([])

  // Resultado de la comprobacion. `null` = todavia no se comprobo, que NO es lo
  // mismo que "salio mal": no se bloquea el envio por no haber comprobado.
  const [probando, setProbando] = useState(false)
  const [veredicto, setVeredicto] = useState<Veredicto | null>(null)

  // Se valida aqui lo mismo que valida la ruta, no para sustituirla sino para
  // no mandar una peticion que ya se sabe que vuelve en 422.
  const idFinal = idTocado ? id : sugerirId(name)
  const idValido = RE_APP_ID.test(idFinal)
  const urlValida = /^https:\/\/[^\s/]+\./.test(baseUrl)
  const puedeEnviar = name.trim().length >= 2 && idValido && urlValida && !busy

  async function comprobar() {
    if (!urlValida) return
    setProbando(true)
    setVeredicto(null)
    try {
      const res = await fetch('/api/connectors/apps/comprobar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          base_url: baseUrl.trim(),
          embed_path: kind === 'embed' ? embedPath.trim() : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo comprobar')
      setVeredicto(data as Veredicto)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setProbando(false)
    }
  }

  async function proponer() {
    if (!puedeEnviar) return
    setBusy(true)
    try {
      const res = await fetch('/api/connectors/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          id: idFinal,
          name: name.trim(),
          description: description.trim() || undefined,
          base_url: baseUrl.trim(),
          kind,
          embed_path: kind === 'embed' && embedPath.trim() ? embedPath.trim() : undefined,
          requested_scopes: scopes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo proponer')

      toast.success('Propuesta enviada. Queda en borrador hasta que la revisen.')
      router.push(`/w/${workspaceSlug}/marketplace`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(false)
    }
  }

  const hayAlto = scopes.some((s) => SCOPE_CATALOG.find((d) => d.scope === s)?.risk === 'alto')
  const porApp = ['wli', 'wlo', 'wlm'] as const

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link
        href={`/w/${workspaceSlug}/marketplace`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> Marketplace
      </Link>

      <div className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Publicar una herramienta</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground leading-relaxed">
          Tu herramienta vive en tu propio repositorio y tu propio deploy, en el lenguaje que
          quieras. WLO no compila el código de nadie: guarda a dónde apunta, qué permisos pidió y
          en qué estado de revisión está. Aquí no se sube ningún archivo.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem] lg:items-start">
        <div className="space-y-4">
          <Paso
            numero={1}
            icono={<Globe size={16} />}
            titulo="Dónde vive"
            sub="El nombre con el que la va a ver el equipo y la URL donde ya está desplegada."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-foreground">Nombre</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Calculadora de m2"
                  className={claseCampo}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-foreground">Identificador</span>
                <input
                  value={idFinal}
                  onChange={(e) => { setIdTocado(true); setId(e.target.value) }}
                  placeholder="calculadora-m2"
                  className={`${claseCampo} font-mono`}
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {idFinal && !idValido
                    ? 'Solo minúsculas, números y guion, entre 2 y 39 caracteres.'
                    : 'Se usa en la URL y no se puede cambiar después.'}
                </span>
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-foreground">Qué hace</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Para qué sirve y quién la mantiene."
                className={`${claseCampo} resize-none`}
              />
            </label>

            <div>
              <span className="text-xs font-medium text-foreground">URL del deploy</span>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); setVeredicto(null) }}
                  placeholder="https://mi-herramienta.vercel.app"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
                />
                <button
                  type="button"
                  onClick={comprobar}
                  disabled={!urlValida || probando}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {probando ? <Loader2 size={13} className="animate-spin" /> : null}
                  {probando ? 'Probando' : 'Probar'}
                </button>
              </div>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {baseUrl.length > 8 && !urlValida
                  ? 'Tiene que ser https. Sin eso no se acepta.'
                  : 'Tu propio proyecto de Vercel, Netlify o donde sea.'}
              </span>
            </div>

            {veredicto && (
              <div
                className={`flex items-start gap-2.5 rounded-lg border p-3 ${
                  veredicto.ok
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-amber-500/30 bg-amber-500/5'
                }`}
              >
                {veredicto.ok
                  ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  : <XCircle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {veredicto.titulo}
                    {veredicto.status ? (
                      <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                        HTTP {veredicto.status}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {veredicto.detalle}
                  </p>
                </div>
              </div>
            )}
          </Paso>

          <Paso
            numero={2}
            icono={<Puzzle size={16} />}
            titulo="Cómo se usa"
            sub="Si tiene pantalla propia se abre dentro de WLO. Si no, solo habla por API."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {(['embed', 'connector'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setKind(k); setVeredicto(null) }}
                  className={`rounded-lg border px-3 py-3 text-left transition ${
                    kind === k
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="block text-xs font-medium text-foreground">
                    {k === 'embed' ? 'Pantalla' : 'Conector'}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {k === 'embed'
                      ? 'Se abre dentro de WLO, en un marco.'
                      : 'Habla con WLO por API, sin interfaz propia.'}
                  </span>
                </button>
              ))}
            </div>

            {kind === 'embed' && (
              <label className="block">
                <span className="text-xs font-medium text-foreground">Ruta que se abre</span>
                <input
                  value={embedPath}
                  onChange={(e) => { setEmbedPath(e.target.value); setVeredicto(null) }}
                  placeholder="/embed"
                  className={`${claseCampo} font-mono`}
                />
                <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
                  Para que se vea por dentro, su dominio tiene que estar en la lista del CSP de WLO,
                  y eso es un cambio de código revisado. Mientras no esté, la herramienta queda
                  registrada pero no se puede abrir dentro.
                </span>
              </label>
            )}
          </Paso>

          <Paso
            numero={3}
            icono={<KeyRound size={16} />}
            titulo="Qué permisos necesita"
            sub="Marcar aquí no concede nada. Cada workspace decide cuáles acepta al instalarla."
          >
            <div className="space-y-4">
              {porApp.map((app) => {
                const delApp = SCOPE_CATALOG.filter((s) => s.app === app)
                if (delApp.length === 0) return null
                return (
                  <div key={app}>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {APP_TITULO[app]}
                    </span>
                    <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                      {delApp.map((s) => {
                        const activo = scopes.includes(s.scope)
                        return (
                          <label
                            key={s.scope}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition ${
                              activo ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={activo}
                              onChange={(e) =>
                                setScopes((prev) =>
                                  e.target.checked
                                    ? [...prev, s.scope]
                                    : prev.filter((x) => x !== s.scope),
                                )
                              }
                              className="mt-0.5"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-foreground">{s.label}</span>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] ${RIESGO[s.risk]}`}>
                                  {s.risk}
                                </span>
                              </span>
                              <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                {s.scope}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {hayAlto && (
              <p className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                Estás pidiendo permisos de riesgo alto. Espera que la revisión te pregunte por qué
                hacen falta.
              </p>
            )}
          </Paso>
        </div>

        {/* Resumen y consecuencias, siempre a la vista. */}
        <aside className="lg:sticky lg:top-6 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resumen
            </h3>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Nombre</dt>
                <dd className="min-w-0 truncate text-right text-foreground">{name || '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Identificador</dt>
                <dd className="min-w-0 truncate text-right font-mono text-foreground">
                  {idFinal || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Tipo</dt>
                <dd className="text-foreground">{kind === 'embed' ? 'Pantalla' : 'Conector'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Permisos</dt>
                <dd className="text-foreground">{scopes.length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">URL probada</dt>
                <dd className={veredicto ? (veredicto.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400') : 'text-muted-foreground'}>
                  {veredicto ? (veredicto.ok ? 'responde' : 'con problema') : 'sin probar'}
                </dd>
              </div>
            </dl>

            <button
              onClick={proponer}
              disabled={!puedeEnviar}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {busy ? 'Enviando...' : 'Enviar a revisión'}
            </button>
          </div>

          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Qué pasa después
            </h3>
            <ol className="mt-2.5 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <li>
                <span className="text-foreground">1.</span> Queda en <strong>borrador</strong>. No se
                lista y no se puede instalar, ni con la petición directa.
              </li>
              <li>
                <span className="text-foreground">2.</span> El mando de la organización la revisa y
                la aprueba o la rechaza.
              </li>
              <li>
                <span className="text-foreground">3.</span> Un admin del workspace la instala y
                decide qué permisos concede.
              </li>
              <li>
                <span className="text-foreground">4.</span> Si es de pantalla, su dominio se agrega
                a la lista del CSP. Hasta entonces no abre por dentro.
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  )
}
