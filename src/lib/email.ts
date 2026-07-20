/**
 * Envio de correo transaccional (invitaciones + notificaciones).
 *
 * GATEADO POR CONFIGURACION: si no hay RESEND_API_KEY en el entorno, todo es
 * no-op silencioso (loguea y regresa {sent:false}). Asi el codigo vive en prod
 * sin romper nada; el dia que se ponga la key + dominio verificado en Vercel,
 * empieza a enviar solo, sin cambios de codigo.
 *
 * Env requeridas para enviar de verdad:
 *   RESEND_API_KEY   -> API key de Resend
 *   EMAIL_FROM       -> remitente verificado, ej. "WLO <notificaciones@pavific.com>"
 *   NEXT_PUBLIC_APP_URL -> base para los enlaces (ya existe)
 */

const BRAND = '#2563EB' // acento azul unico del ecosistema

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
}

interface SendEmailParams {
  to: string
  subject: string
  html: string
  replyTo?: string
}

/**
 * Envia un correo. No-op (sin error) si el email no esta configurado. Best
 * effort: nunca lanza, para no romper el flujo que lo invoca.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) {
    // Config ausente: no es un error, el feature esta apagado a proposito.
    return { sent: false }
  }
  if (!params.to || !params.to.includes('@')) {
    return { sent: false }
  }
  try {
    // Import perezoso: no cargar el SDK si el feature esta apagado.
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY as string)
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM as string,
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    })
    if (error) {
      console.error('[sendEmail] resend error:', error)
      return { sent: false }
    }
    return { sent: true }
  } catch (err) {
    console.error('[sendEmail] error:', err)
    return { sent: false }
  }
}

// ── Plantillas ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Cascaron de marca comun a todos los correos (Inter, acento azul, sin emojis). */
function shell(opts: { heading: string; bodyHtml: string; ctaLabel?: string; ctaUrl?: string }): string {
  const cta =
    opts.ctaLabel && opts.ctaUrl
      ? `<tr><td style="padding:8px 0 4px;">
           <a href="${escapeHtml(opts.ctaUrl)}"
              style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
                     font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">
             ${escapeHtml(opts.ctaLabel)}
           </a>
         </td></tr>`
      : ''
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;
                    font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="background:${BRAND};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:${BRAND};">WLO</div>
          <h1 style="margin:12px 0 4px;font-size:18px;line-height:1.35;color:#111827;font-weight:600;">
            ${escapeHtml(opts.heading)}
          </h1>
        </td></tr>
        <tr><td style="padding:4px 28px 4px;font-size:14px;line-height:1.6;color:#374151;">
          ${opts.bodyHtml}
        </td></tr>
        <table role="presentation" cellpadding="0" cellspacing="0" style="padding:12px 28px 24px;">
          ${cta}
        </table>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;">
          Recibiste este correo porque tienes actividad en WLO. Puedes gestionar tus notificaciones dentro de la app.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

/** Correo de una notificacion (asignacion, mencion, comentario, etc.). */
export function renderNotificationEmail(opts: {
  recipientName: string
  actorName: string
  phrase: string      // ej. "te menciono en"
  objectLabel: string // ej. "una tarea"
  objectTitle?: string | null
  url: string
}): { subject: string; html: string } {
  const title = opts.objectTitle ? `"${opts.objectTitle}"` : opts.objectLabel
  const subject = `${opts.actorName} ${opts.phrase} ${opts.objectTitle ? opts.objectTitle : opts.objectLabel}`
  const bodyHtml = `
    <p style="margin:0 0 10px;">Hola ${escapeHtml(opts.recipientName)},</p>
    <p style="margin:0;">
      <strong>${escapeHtml(opts.actorName)}</strong> ${escapeHtml(opts.phrase)}
      <strong>${escapeHtml(title)}</strong>.
    </p>`
  return {
    subject,
    html: shell({ heading: subject, bodyHtml, ctaLabel: 'Abrir en WLO', ctaUrl: opts.url }),
  }
}

/** Correo de invitacion a un workspace (link con codigo). */
export function renderInviteEmail(opts: {
  inviterName: string
  workspaceName: string
  joinUrl: string
  hasPassword: boolean
}): { subject: string; html: string } {
  const subject = `${opts.inviterName} te invito a ${opts.workspaceName} en WLO`
  const pwdNote = opts.hasPassword
    ? `<p style="margin:10px 0 0;color:#6b7280;">Esta invitacion pide una contrasena que ${escapeHtml(opts.inviterName)} te compartira aparte.</p>`
    : ''
  const bodyHtml = `
    <p style="margin:0 0 10px;">Hola,</p>
    <p style="margin:0;">
      <strong>${escapeHtml(opts.inviterName)}</strong> te invito a unirte al espacio de trabajo
      <strong>${escapeHtml(opts.workspaceName)}</strong> en WLO.
    </p>${pwdNote}`
  return {
    subject,
    html: shell({ heading: subject, bodyHtml, ctaLabel: 'Aceptar invitacion', ctaUrl: opts.joinUrl }),
  }
}
