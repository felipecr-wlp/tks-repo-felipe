/** @type {import('next').NextConfig} */
import { readFileSync } from 'node:fs'

// Origenes de herramientas del marketplace que WLO acepta pintar en un iframe.
// La lista NO se escribe aqui: se lee del mismo JSON que consulta el codigo
// (src/lib/connectors/embed.ts). Dos copias de una allowlist siempre terminan
// distintas, y el dia que lo esten la herramienta se ve en blanco sin decir por
// que, porque quien bloquea es el navegador y no deja rastro dentro de la app.
const embedOrigins = JSON.parse(
  readFileSync(new URL('./src/lib/connectors/embed-origins.json', import.meta.url), 'utf8'),
).origins

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
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // `https:` abierto para imagenes, y es a proposito. Un nodo de contenido
      // HTML es casi siempre un correo, y un correo trae sus imagenes del CDN
      // de quien lo armo: Mailchimp, S3, el sitio del cliente. Con una lista de
      // hosts el preview sale roto y nadie sabe por que, porque una imagen
      // bloqueada por CSP no avisa, solo no aparece. Ceder aqui es barato: una
      // imagen no ejecuta codigo, y el HTML ya pasa por sanitizeRichText antes
      // de renderizarse. Lo que NO se abre es script-src ni connect-src, que es
      // por donde se fugarian datos de verdad.
      "img-src 'self' blob: data: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
      ['frame-src https://docs.google.com https://sheets.google.com https://drive.google.com', ...embedOrigins].join(' '),
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
      // El sitio propio. Esto es aparte del CSP y mucho mas estrecho: el CSP
      // decide que puede PINTAR el navegador, esta lista decide que puede
      // DESCARGAR Y REPROCESAR el servidor con next/image. Abrirla entera seria
      // un proxy de imagenes gratis para cualquiera.
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
