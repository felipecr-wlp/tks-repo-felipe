/**
 * Marca WLO (We Love Operations) como SVG inline.
 *
 * Reproduccion vectorial del logo: una "W" angular (trazos con cortes rectos)
 * y un anillo abierto que forma la "O", en ambar. Se hace en SVG (no PNG) para
 * que escale perfecto a cualquier tamano, pese pocos bytes y respete la regla
 * del proyecto de preferir iconos vectoriales.
 *
 * La "W" usa `currentColor`, asi que hereda el color del texto: en el sidebar
 * claro se ve navy (`text-[#16202b]`) y en modo oscuro blanco (`dark:text-white`).
 * El anillo va siempre en ambar de marca.
 */
interface WloLogoProps {
  /** Lado en px del cuadro (el SVG es cuadrado). Default 24. */
  size?: number
  className?: string
  /** Color del anillo "O". Default ambar de marca. */
  accent?: string
}

export function WloLogo({ size = 24, className, accent = '#F6A81C' }: WloLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 100"
      fill="none"
      className={className}
      role="img"
      aria-label="WLO"
    >
      {/* W: hereda currentColor (navy en claro, blanco en oscuro) */}
      <polyline
        points="16,28 34,74 52,38 70,74 88,40"
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      {/* O: anillo ambar abierto hacia la W */}
      <path
        d="M 79.6 30.9 A 23 23 0 1 1 72.2 51.2"
        fill="none"
        stroke={accent}
        strokeWidth="14"
        strokeLinecap="round"
      />
    </svg>
  )
}
