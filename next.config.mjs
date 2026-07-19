/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
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
      "img-src 'self' blob: data: https://lh3.googleusercontent.com https://drive.google.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com",
      "frame-src https://docs.google.com https://sheets.google.com https://drive.google.com",
      "font-src 'self'",
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

  // Image optimization — allow Google CDN for avatars
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
