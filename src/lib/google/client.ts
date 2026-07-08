/**
 * Helpers de Google OAuth para el flujo de Calendar (Conv A).
 *
 * IMPORTANTE: este modulo corre SOLO en el servidor (Route Handlers). Los
 * tokens NUNCA se exponen al cliente. El flujo de Calendar es independiente
 * del login de Supabase: pedimos consentimiento incremental con scope de
 * calendario y guardamos los tokens en la tabla google_connections.
 */
import { google } from 'googleapis'

/**
 * Scopes que pedimos para Calendar. Solo lectura: nunca creamos ni borramos
 * eventos del calendario del usuario. openid + email nos dan el id de la
 * cuenta de Google para identificar la conexion.
 */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
]

/**
 * Base URL de la app. Preferimos NEXT_PUBLIC_APP_URL (registrada en Google
 * Cloud Console) y caemos al origin del request como respaldo en previews.
 */
export function getBaseUrl(origin?: string): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  if (env) return env
  return (origin ?? '').replace(/\/+$/, '')
}

/** redirect_uri exacto que Google debe tener registrado. */
export function getRedirectUri(origin?: string): string {
  return `${getBaseUrl(origin)}/api/google/callback`
}

/** Crea un cliente OAuth2 configurado con las credenciales de la app. */
export function getOAuthClient(origin?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri(origin),
  )
}

/** true si la app tiene configuradas las credenciales de Google OAuth. */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}
