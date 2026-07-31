/**
 * POST /api/workspaces, CERRADO.
 *
 * WLO opera con un solo espacio de trabajo (General). Crear espacios
 * adicionales fragmentaba equipos, documentos y permisos sin que nadie lo
 * pidiera, asi que la capacidad se retiro por decision de producto.
 *
 * La guarda vive AQUI y no solo en la interfaz: esconder un boton no impide un
 * POST a mano. La UI (encabezado del sidebar, paleta de comandos, pagina
 * /settings/workspaces/new) tambien dejo de ofrecerlo, pero esta ruta es la que
 * manda. Para reabrirlo hay que volver a escribir la creacion, a proposito:
 * que sea una decision y no un descuido.
 */
import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'La creación de workspaces está deshabilitada. WLO opera con un solo espacio de trabajo.' },
    { status: 403 }
  )
}
