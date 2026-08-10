/**
 * Guia para construir la academia en video.
 *
 * Vive DENTRO de la app, no en un documento aparte, por una razon concreta:
 * un manual en Drive se lee una vez y se olvida donde quedo. Aqui esta a un
 * clic de la pantalla donde se hace el trabajo, y se actualiza en el mismo
 * commit que cambia la funcionalidad que describe.
 *
 * Es contenido estatico: sin datos, sin consultas, sin costo.
 */
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import {
  ArrowLeft, Video, GitBranch, HelpCircle, ShieldCheck,
  Users, Workflow, AlertTriangle, Lightbulb,
} from 'lucide-react'

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function GuiaPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string } | null }
  const { data: ws } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }
  if (!ws?.workspaces) redirect('/')
  if (!(await isOrgAdmin(user.id))) notFound()

  const base = `/w/${params.workspaceSlug}/academia`

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={`${base}/panel`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Panel
      </Link>

      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
        Cómo construir la academia en video
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        El orden importa: cada paso depende del anterior. Si lo haces al revés
        vas a estar pegando ids a mano.
      </p>

      {/* ── EL ORDEN ────────────────────────────────────────────────────── */}
      <Seccion icono={Workflow} titulo="El orden correcto, y por qué">
        <ol className="space-y-3">
          <Paso n={1} titulo="Sube primero las HOJAS, al final la entrada">
            Una opción no puede llevar a un video que todavía no existe. Si
            grabas «Bienvenida → concreto o asfalto», sube primero los videos
            de concreto y asfalto, y la bienvenida al final. Al revés te toca
            volver a editar todo.
          </Paso>
          <Paso n={2} titulo="Crea el stack antes de subir">
            Al subir puedes elegir el stack, pero solo si ya existe. Créalo en{' '}
            <Codigo>Panel → Stacks</Codigo> y cuélgalo de su escuela.
          </Paso>
          <Paso n={3} titulo="Conecta las ramas en el diagrama, no a mano">
            <Enlace href={`${base}/panel/diagrama`}>Panel → Diagrama</Enlace>.
            Arrastra las cajas y une la parte de ABAJO de un video con la de
            ARRIBA de otro. Cada flecha es una opción. Ahí ves el árbol
            completo y detectas los callejones sin salida.
          </Paso>
          <Paso n={4} titulo="Crea la ruta al final">
            <Codigo>Panel → Rutas</Codigo>, y asígnale el video de entrada. Una
            ruta sin entrada no se puede publicar: es una puerta que no abre.
          </Paso>
          <Paso n={5} titulo="Revisa antes de anunciarlo">
            <Enlace href={`${base}/panel`}>Panel → Pruebas</Enlace> te dice si
            quedó algo roto: enlaces a videos borrados, preguntas que nadie
            puede contestar, videos que nadie va a encontrar. No gasta datos.
          </Paso>
        </ol>
      </Seccion>

      {/* ── LAS DOS INTERACTIVIDADES ────────────────────────────────────── */}
      <Seccion icono={GitBranch} titulo="Las dos interactividades, y cuándo usar cada una">
        <div className="space-y-4">
          <Caja icono={HelpCircle} color="amber" titulo="Quiz: hay respuesta correcta">
            El video se pausa, pregunta, y <strong>no avanza hasta acertar</strong>.
            Al fallar muestra tu explicación y ofrece volver a ver esa parte.
            <p className="mt-2">
              Úsalo para lo que <strong>no admite opinión</strong>: seguridad,
              orden de un procedimiento, un límite de temperatura.
            </p>
          </Caja>
          <Caja icono={GitBranch} color="sky" titulo="Ramificación: ninguna opción está mal">
            Cada opción es un camino distinto. Marca la casilla
            <Codigo>Sin respuesta correcta (ramificación)</Codigo>.
            <p className="mt-2">
              Úsalo para <strong>dejar elegir</strong>: «¿qué aprendes hoy,
              concreto o asfalto?». Es lo que hace que el curso se sienta a la
              medida de quien lo ve.
            </p>
          </Caja>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Se combinan:</strong> en un quiz,
            una respuesta incorrecta puede mandar a un video de refuerzo en vez
            de solo decir «mal». Esa es la forma más útil de los dos juntos.
          </p>
        </div>
      </Seccion>

      {/* ── SINTAXIS ─────────────────────────────────────────────────────── */}
      <Seccion icono={Video} titulo="Cómo se escriben las opciones">
        <p>Una por línea. Para que lleve a otro video, la flecha y el id:</p>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
{`Reviso el aceite primero -> 3f1c2b4a-...  @30
Arranco sin revisar`}
        </pre>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li><Codigo>-&gt;</Codigo> lleva a otro video. El id lo copias con el botón <Codigo>Copiar id</Codigo> de la pestaña Videos, o lo eliges por nombre desde el editor.</li>
          <li><Codigo>@30</Codigo> arranca el destino en el segundo 30. Opcional.</li>
          <li>Sin flecha, la opción solo continúa el mismo video.</li>
        </ul>
        <Aviso>
          En el <strong>diagrama</strong> no escribes ids: arrastras y él los
          pone. Escribir a mano es solo para ajustes finos.
        </Aviso>
      </Seccion>

      {/* ── CERTIFICACION ───────────────────────────────────────────────── */}
      <Seccion icono={ShieldCheck} titulo="Cuándo marcar un video como certificable">
        <p>
          Tres casillas al subir o editar, y cada una responde a una pregunta
          distinta:
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <strong className="text-foreground">Exigir acuse</strong>: la
            persona declara que lo entendió. Es lo que enseñas si alguien dice
            «nadie me dijo».
          </li>
          <li>
            <strong className="text-foreground">Exigir firma de supervisor</strong>:
            alguien más confirma que <strong>sabe hacerlo</strong>, no solo que
            le dio play. Nadie puede firmarse a sí mismo.
          </li>
          <li>
            <strong className="text-foreground">Vigencia en meses</strong>: la
            capacitación caduca. Un auditor no pregunta quién tomó el curso,
            pregunta quién lo tiene <strong>vigente hoy</strong>.
          </li>
        </ul>
        <Aviso>
          No marques todo como certificable. Si todo exige firma, el supervisor
          deja de firmar y la firma pierde el valor que tenía.
        </Aviso>
      </Seccion>

      {/* ── PERMISOS ────────────────────────────────────────────────────── */}
      <Seccion icono={Users} titulo="Quién ve cada cosa">
        <ul className="space-y-2 text-sm">
          <li><strong className="text-foreground">Todos</strong>: cualquiera del equipo. Es lo normal.</li>
          <li><strong className="text-foreground">Por perfiles</strong>: etiquetas libres (foreman, concreto, asfalto). Lo más útil para cuadrillas.</li>
          <li><strong className="text-foreground">Por personas</strong>: uno por uno, desde <Codigo>Quién lo ve</Codigo>.</li>
        </ul>
        <Aviso>
          Elegir «por perfiles» y no marcar ninguno, o «por personas» y no
          nombrar a nadie, deja el video invisible para <strong>todo el
          mundo</strong>. Tú lo seguirás viendo porque eres admin, así que el
          panel de Pruebas lo marca como error.
        </Aviso>
      </Seccion>

      {/* ── CONSEJOS DE CONTENIDO ───────────────────────────────────────── */}
      <Seccion icono={Lightbulb} titulo="Consejos que evitan rehacer el trabajo">
        <ul className="space-y-2.5 text-sm">
          <li>
            <strong className="text-foreground">Videos cortos.</strong> Uno por
            decisión o por paso. Un video de 40 minutos no se puede ramificar y
            nadie lo termina en el celular.
          </li>
          <li>
            <strong className="text-foreground">Pon la pregunta después de
            enseñar la respuesta</strong>, no antes. Si preguntas en el segundo
            5 algo que explicas en el 40, todos fallan y se frustran.
          </li>
          <li>
            <strong className="text-foreground">Capítulos siempre.</strong>
            Cuestan un minuto y son lo que hace que alguien vuelva a buscar
            «cómo era el compactado» sin ver los 8 minutos otra vez.
          </li>
          <li>
            <strong className="text-foreground">Graba en horizontal y con buen
            audio.</strong> En obra el ruido se come la voz; un micrófono de
            solapa barato mejora más que una cámara cara.
          </li>
          <li>
            <strong className="text-foreground">Empieza con uno solo.</strong>
            Sube «cómo inicia el día de concreto», dáselo a una cuadrilla y mira
            si lo ven. Eso te dice más que planear diez.
          </li>
        </ul>
      </Seccion>

      {/* ── LIMITES ─────────────────────────────────────────────────────── */}
      <Seccion icono={AlertTriangle} titulo="Límites que conviene saber antes">
        <ul className="space-y-2 text-sm">
          <li>
            <strong className="text-foreground">Tamaño de archivo.</strong> Si
            un video rebota por tamaño, el tope no está en esta app: es el
            límite global de subida del proyecto en Supabase
            (<Codigo>Storage → Settings → Upload file size limit</Codigo>).
          </li>
          <li>
            <strong className="text-foreground">Editar no reemplaza el archivo.</strong>
            Puedes cambiar título, capítulos, preguntas y certificación cuando
            quieras. Para cambiar el <strong>video</strong>, subes uno nuevo: el
            avance de la gente pertenece a lo que vieron.
          </li>
          <li>
            <strong className="text-foreground">Borrar avisa.</strong> Si otros
            videos ramifican hacia el que borras, el sistema te dice cuáles
            antes de dejarte.
          </li>
          <li>
            <strong className="text-foreground">Sin bitrate adaptativo.</strong>
            Con señal mala en obra el video se congela en vez de bajar de
            calidad. Si eso pasa seguido, se conecta un servicio de streaming y
            nada de lo que armaste se toca.
          </li>
        </ul>
      </Seccion>

      <div className="mt-8 flex flex-wrap gap-2">
        <Enlace href={`${base}/panel/diagrama`} boton>Ir al diagrama</Enlace>
        <Enlace href={`${base}/panel`} boton>Ir al panel</Enlace>
        <Enlace href={`${base}/videos`} boton>Ver la galería</Enlace>
      </div>
    </div>
  )
}

function Seccion({
  icono: Icono, titulo, children,
}: { icono: typeof Video; titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
        <Icono className="h-5 w-5 text-primary" /> {titulo}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <div>
        <p className="font-semibold text-foreground">{titulo}</p>
        <p className="mt-0.5">{children}</p>
      </div>
    </li>
  )
}

function Caja({
  icono: Icono, color, titulo, children,
}: { icono: typeof Video; color: 'amber' | 'sky'; titulo: string; children: React.ReactNode }) {
  const clase = color === 'amber'
    ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-sky-500/40 bg-sky-500/5'
  const icono = color === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'
  return (
    <div className={`rounded-lg border p-3 ${clase}`}>
      <p className="flex items-center gap-2 font-semibold text-foreground">
        <Icono className={`h-4 w-4 ${icono}`} /> {titulo}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Codigo({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function Enlace({
  href, children, boton,
}: { href: string; children: React.ReactNode; boton?: boolean }) {
  return (
    <Link
      href={href}
      className={boton
        ? 'rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted'
        : 'font-medium text-primary hover:underline'}
    >
      {children}
    </Link>
  )
}
