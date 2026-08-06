import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Origenes que se pueden embeber en iframes. La lista autoritativa vive en
 * `src/lib/connectors/embed-origins.json`. Agregar un origen es un cambio de
 * codigo con revision: una fila de base de datos no puede autorizarse sola a
 * correr dentro de la app.
 *
 * El archivo se lee al BUILDEAR, no en runtime. Vercel no lo re-lee entre
 * requests asi que un redeploy es obligatorio despues de cada cambio.
 */
let frameSrcOrigins = []
try {
  const origenes = JSON.parse(
    readFileSync(resolve(__dirname, 'src/lib/connectors/embed-origins.json'), 'utf-8'),
  )
  if (Array.isArray(origenes.origins)) frameSrcOrigins = origenes.origins
} catch {
  // Si el archivo no existe (primer build sin el) no es un error fatal: se
  // sigue con los origenes de Google Drive que ya estaban, y los embeds de
  // herramientas simplemente no se van a ver. El build no debe romperse por
  // un archivo de configuracion.
}

/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // La app es 100% HTTPS (Vercel). HSTS fuerza al navegador a no volver a HTTP
  // durante 2 anios, protege contra downgrade/MITM en subdominios. preload lo
  // habilita para la lista precargada de navegadores.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    // `()` es lista VACIA: no lo puede usar nadie, ni siquiera nuestro propio
    // origen. Estaba asi porque la app no usa camara ni microfono, y era
    // defensa en profundidad barata.
    //
    // Salio caro por un lado que no se habia pensado: grabar un Loom de la app.
    // Los grabadores piden la camara desde un content script, que vive en el
    // marco de NUESTRA pagina, asi que se come nuestra politica. El resultado
    // era el peor de los mundos: la pantalla se seguia grabando (display-capture
    // va por su cuenta y nunca se bloqueo) y solo se apagaba la cara, sin ningun
    // aviso, porque quien bloquea es el navegador y no deja rastro en la app.
    // Alguien intentando grabar una demo no tenia forma de saber que el culpable
    // era una cabecera nuestra.
    //
    // `(self)` devuelve la camara y el microfono a nuestro origen, que es donde
    // corre el grabador. NO se abre a `*` a proposito: con `*` tambien podrian
    // pedirlos los iframes del marketplace (frame-src de mas abajo), y el
    // navegador enseña el permiso a nombre de wlo.vercel.app, asi que una
    // herramienta de terceros podria pedir camara y parecer que la pide WLO.
    //
    // geolocation se queda cerrado: nada en la app la usa y nadie la graba.
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
      [
        'frame-src',
        'https://docs.google.com',
        'https://sheets.google.com',
        'https://drive.google.com',
        ...frameSrcOrigins,
      ].join(' '),
      "font-src 'self'",
      // Endurecimiento adicional: nadie externo puede enmarcar la app (refuerza
      // X-Frame-Options en navegadores modernos), sin <base> inyectable, y se
      // bloquean <object>/<embed> (la app no los usa; Excalidraw es canvas).
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; '),
  },
]

const nextConfig = {
  // Security headers on all routes
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  // Image optimization, allow Google CDN for avatars
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'drive.google.com',
        pathname: '/thumbnail/**',
      },
      {
        protocol: 'https',
        hostname: 'www.welovepaving.com',
        pathname: '/**',
      },
    ],
  },

  // Supabase Realtime needs websockets
  experimental: {
    serverComponentsExternalPackages: ['@supabase/ssr'],
    // Router Cache: por defecto Next 14.2 cachea el RSC de rutas dinamicas 30s
    // en el cliente. Eso hacia que al volver (navegacion suave) a una nota o
    // pizarra recien editada se mostrara la version vieja "vacia", como si no
    // se hubiera guardado. Con 0 la navegacion siempre re-consulta datos frescos.
    staleTimes: { dynamic: 0, static: 180 },
  },

  // Exclude Excalidraw from server bundle (browser-only)
  webpack: (config) => {
    config.externals = config.externals || []
    return config
  },
}

export default nextConfig
