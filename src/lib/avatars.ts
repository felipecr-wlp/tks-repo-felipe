/**
 * Galería de avatares mascota WLO (branding WLP: casco/acentos amarillos).
 * Se sirven como estáticos desde public/avatars. El avatar elegido se guarda
 * como ruta en profiles.avatar_url (no hay bucket de storage ni subida).
 *
 * El husky está RESERVADO para el Admin (regla de Ali): solo un usuario con
 * org_role admin/owner puede elegirlo. Se valida en cliente (galería) y en el
 * servidor (PATCH /api/profile), nunca solo en la UI.
 */
export type AvatarOption = { path: string; label: string; adminOnly?: boolean }

export const AVATARS: AvatarOption[] = [
  { path: '/avatars/husky.png', label: 'Husky (Admin)', adminOnly: true },
  { path: '/avatars/a01.png', label: 'Avatar 1' },
  { path: '/avatars/a02.png', label: 'Avatar 2' },
  { path: '/avatars/a03.png', label: 'Avatar 3' },
  { path: '/avatars/a04.png', label: 'Avatar 4' },
  { path: '/avatars/a05.png', label: 'Avatar 5' },
  { path: '/avatars/a06.png', label: 'Avatar 6' },
  { path: '/avatars/a07.png', label: 'Avatar 7' },
  { path: '/avatars/a08.png', label: 'Avatar 8' },
  { path: '/avatars/a09.png', label: 'Avatar 9' },
  { path: '/avatars/a10.png', label: 'Avatar 10' },
  { path: '/avatars/a11.png', label: 'Avatar 11' },
  { path: '/avatars/a12.png', label: 'Avatar 12' },
  { path: '/avatars/a13.png', label: 'Avatar 13' },
  { path: '/avatars/a14.png', label: 'Avatar 14' },
  { path: '/avatars/a15.png', label: 'Avatar 15' },
  { path: '/avatars/a16.png', label: 'Avatar 16' },
  { path: '/avatars/a17.png', label: 'Avatar 17' },
  { path: '/avatars/a18.png', label: 'Avatar 18' },
  { path: '/avatars/a19.png', label: 'Avatar 19' },
  { path: '/avatars/a20.png', label: 'Avatar 20' },
  { path: '/avatars/a21.png', label: 'Avatar 21' },
  { path: '/avatars/a22.png', label: 'Avatar 22' },
]

/** Rutas válidas para guardar en avatar_url. */
export const AVATAR_PATHS: ReadonlySet<string> = new Set(AVATARS.map(a => a.path))

/** Rutas reservadas a admins (el husky). */
export const ADMIN_ONLY_AVATARS: ReadonlySet<string> = new Set(
  AVATARS.filter(a => a.adminOnly).map(a => a.path),
)

/** org_role que cuentan como "Admin" para desbloquear avatares reservados. */
export const ADMIN_ROLES: ReadonlySet<string> = new Set(['admin', 'owner'])
