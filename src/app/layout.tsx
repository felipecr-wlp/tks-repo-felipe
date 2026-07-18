import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import { ConfirmDialogHost } from '@/components/ConfirmDialog'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'WLO', template: '%s · WLO' },
  description: 'WLO, sistema operativo de trabajo interno',
  robots: { index: false, follow: false }, // app interna, no indexar
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={inter.className}>
        {children}
        <Toaster position="bottom-right" richColors />
        <ConfirmDialogHost />
      </body>
    </html>
  )
}
