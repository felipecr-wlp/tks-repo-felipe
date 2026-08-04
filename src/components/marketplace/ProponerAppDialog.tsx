'use client'

/**
 * Proponer una herramienta al marketplace.
 *
 * Esta pantalla es la boca de entrada de POST /api/connectors/apps, que existia
 * desde el principio pero no la llamaba nadie: la unica forma de dar de alta una
 * herramienta era una peticion a mano. Un catalogo abierto al que solo se entra
 * por consola es un catalogo cerrado con pasos extra.
 *
 * Lo que se propone NO queda instalado ni visible. Nace en `draft`, y en borrador
 * ni se lista ni se puede instalar aunque alguien mande la peticion directa. Eso
 * lo hace cumplir el servidor, no este formulario; aqui se dice en voz alta para
 * que quien propone no crea que ya publico algo.
 *
 * Los permisos se piden aqui y se conceden en otro lado (la pantalla de
 * instalacion, workspace por workspace). Marcar una casilla aqui no concede nada:
 * declara lo que la herramienta necesita. Esa separacion es la que impide que
 * publicar una version que pide mas se autoconceda sola.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, ShieldAlert } from 'lucide-react'
import { SCOPE_CATALOG } from '@/lib/connectors/scopes'
import { RE_APP_ID } from '@/lib/validation'

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
 * `normalize('NFD')` al separar "ñ" en "n" + tilde. Se arma con fromCharCode y no
 * con el rango escrito en el literal porque esos caracteres son INVISIBLES en el
 * editor: cualquiera los tomaria por basura y los borraria "limpiando".
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

export function ProponerAppDialog({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTocado, setIdTocado] = useState(false)
  const [description, setDescription] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://')
  const [kind, setKind] = useState<'connector' | 'embed'>('connector')
  const [embedPath, setEmbedPath] = useState('')
  const [scopes, setScopes] = useState<string[]>([])

  function cerrar() {
    setAbierto(false)
    setName(''); setId(''); setIdTocado(false); setDescription('')
    setBaseUrl('https://'); setKind('connector'); setEmbedPath(''); setScopes([])
  }

  // Se valida aqui lo mismo que valida la ruta, no para sustituirla sino para no
  // mandar una peticion que ya se sabe que vuelve en 422.
  const idFinal = idTocado ? id : sugerirId(name)
  const idValido = RE_APP_ID.test(idFinal)
  const urlValida = /^https:\/\/[^\s/]+\./.test(baseUrl)
  const puedeEnviar = name.trim().length >= 2 && idValido && urlValida && !busy

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

      toast.success('Propuesta enviada. Queda en borrador hasta que la revise el mando de la organizacion.')
      cerrar()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setBusy(false)
    }
  }

  const porApp = ['wli', 'wlo', 'wlm'] as const

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-xs rounded-lg hover:bg-muted"
      >
        <Plus size={13} /> Proponer herramienta
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-foreground">Proponer una herramienta</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              La herramienta vive en tu propio repositorio y tu propio deploy, en el lenguaje que
              quieras. WLO no compila tu codigo: guarda a donde apunta y que permisos pide. Al
              enviarla queda en <strong>borrador</strong>, no se lista ni se puede instalar hasta que
              alguien la revise.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-foreground">Nombre</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Calculadora de m2"
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-foreground">Identificador</span>
                <input
                  value={idFinal}
                  onChange={(e) => { setIdTocado(true); setId(e.target.value) }}
                  placeholder="calculadora-m2"
                  className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {idFinal && !idValido
                    ? 'Solo minusculas, numeros y guion, entre 2 y 39 caracteres.'
                    : 'Se usa en la URL y no se puede cambiar despues.'}
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-foreground">Que hace</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Para que sirve y quien la mantiene."
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-foreground">URL del deploy</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://mi-herramienta.vercel.app"
                  className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {baseUrl.length > 8 && !urlValida
                    ? 'Tiene que ser https. Sin eso no se acepta.'
                    : 'Tu propio proyecto de Vercel, Netlify o donde sea. No se sube nada aqui.'}
                </span>
              </label>

              <div>
                <span className="text-xs font-medium text-foreground">Como se usa</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(['connector', 'embed'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`px-3 py-2 text-left rounded-lg border text-xs ${
                        kind === k ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span className="block text-foreground font-medium">
                        {k === 'connector' ? 'Conector' : 'Pantalla'}
                      </span>
                      <span className="block text-[11px] text-muted-foreground mt-0.5">
                        {k === 'connector'
                          ? 'Habla con WLO por API, sin interfaz propia.'
                          : 'Se abre dentro de WLO en un marco.'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {kind === 'embed' && (
                <label className="block">
                  <span className="text-xs font-medium text-foreground">Ruta que se abre</span>
                  <input
                    value={embedPath}
                    onChange={(e) => setEmbedPath(e.target.value)}
                    placeholder="/embed"
                    className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
                    Para que se vea por dentro, su dominio tiene que estar en la lista del CSP, y eso
                    es un cambio de codigo revisado. Si no esta, se abre en pestana aparte.
                  </span>
                </label>
              )}

              <div>
                <span className="text-xs font-medium text-foreground">Permisos que necesita</span>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Marcar aqui no concede nada. Cada workspace decide cuales acepta al instalarla.
                </p>
                <div className="mt-2 space-y-3">
                  {porApp.map((app) => {
                    const delApp = SCOPE_CATALOG.filter((s) => s.app === app)
                    if (delApp.length === 0) return null
                    return (
                      <div key={app}>
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {APP_TITULO[app]}
                        </span>
                        <div className="mt-1 space-y-1">
                          {delApp.map((s) => (
                            <label
                              key={s.scope}
                              className="flex items-start gap-2.5 p-2 rounded-lg border border-border cursor-pointer hover:bg-muted/50"
                            >
                              <input
                                type="checkbox"
                                checked={scopes.includes(s.scope)}
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
                                <span className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-foreground">{s.label}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${RIESGO[s.risk]}`}>
                                    riesgo {s.risk}
                                  </span>
                                </span>
                                <span className="block text-[10px] text-muted-foreground font-mono">
                                  {s.scope}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {scopes.some((s) => SCOPE_CATALOG.find((d) => d.scope === s)?.risk === 'alto') && (
                <p className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
                  <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                  Estas pidiendo permisos de riesgo alto. Espera que la revision te pregunte por que
                  hacen falta.
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={cerrar}
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={proponer}
                disabled={!puedeEnviar}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Enviando...' : 'Enviar a revision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
