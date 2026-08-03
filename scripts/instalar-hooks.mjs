/**
 * Apunta los hooks de git a `.githooks/`, que si viaja en el repo.
 *
 * Los hooks viven en `.git/hooks/`, que NO se versiona: por eso un hook util se
 * queda en la maquina de quien lo escribio y nadie mas lo tiene. `core.hooksPath`
 * resuelve eso apuntando git a una carpeta normal del proyecto.
 *
 * Corre como `postinstall`, asi que se instala solo la primera vez que alguien
 * hace `npm install` tras clonar. No hay paso manual que recordar, que es la
 * unica forma de que esto llegue a todos.
 *
 * NUNCA falla. Si no hay git (Vercel construye desde un tarball sin `.git`), o
 * la version de git es vieja, sale en silencio con codigo 0. Un hook de
 * conveniencia jamas debe tumbar un build de produccion.
 */
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  console.log('hooks de git apuntando a .githooks/ (freno de mano para master activo)')
} catch {
  // Sin repo git o sin git instalado. No hay nada que instalar y no es un error.
}
