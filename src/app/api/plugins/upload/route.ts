import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import * as fs from 'fs'
import * as path from 'path'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const workspaceId = formData.get('workspace_id') as string | null

  if (!file || !workspaceId) return NextResponse.json({ error: 'Faltan file o workspace_id' }, { status: 400 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admins pueden instalar' }, { status: 403 })
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const pluginsDir = path.join(process.cwd(), 'plugins')

    // Leer ZIP manualmente para extraer manifest.json
    const manifest = extractManifestFromZip(buffer)
    if (!manifest || !manifest.id) {
      return NextResponse.json({ error: 'ZIP invalido: falta manifest.json con id' }, { status: 400 })
    }

    // Crear directorio del plugin
    const pluginDir = path.join(pluginsDir, manifest.id)
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true })

    // Extraer archivos del ZIP
    extractZip(buffer, pluginDir)

    // Registrar en connector_apps si no existe
    const { error: appErr } = await admin.from('connector_apps').upsert({
      id: manifest.id,
      name: manifest.name || manifest.id,
      icon: manifest.icon || 'puzzle',
      base_url: '',
    }, { onConflict: 'id' })
    if (appErr) console.error('[upload] connector_apps upsert:', appErr)

    // Instalar en el workspace
    const { data: install, error: instErr } = await admin
      .from('connector_installs')
      .insert({
        workspace_id: workspaceId,
        app_id: manifest.id,
        plugin_type: manifest.type === 'widget' ? 'widget' : 'widget',
        manifest: manifest,
        enabled: true,
        installed_by: user.id,
      })
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (instErr) {
      console.error('[upload] install insert:', instErr)
      return NextResponse.json({ error: 'Error al instalar: ' + instErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, pluginId: install?.id, manifest }, { status: 201 })
  } catch (e: any) {
    console.error('[upload] error:', e)
    return NextResponse.json({ error: 'Error al procesar: ' + e.message }, { status: 500 })
  }
}

function extractManifestFromZip(buffer: Buffer): any | null {
  // Buscar manifest.json en el ZIP
  let pos = 0
  while (pos < buffer.length - 30) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break
    const nameLen = buffer.readUInt16LE(pos + 26)
    const extraLen = buffer.readUInt16LE(pos + 28)
    const compSize = buffer.readUInt32LE(pos + 18)
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString('utf8')
    const dataStart = pos + 30 + nameLen + extraLen

    if (name === 'manifest.json') {
      return JSON.parse(buffer.slice(dataStart, dataStart + compSize).toString('utf8'))
    }

    pos = dataStart + compSize
  }
  return null
}

function extractZip(buffer: Buffer, outDir: string) {
  let pos = 0
  while (pos < buffer.length - 30) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break
    const nameLen = buffer.readUInt16LE(pos + 26)
    const extraLen = buffer.readUInt16LE(pos + 28)
    const compSize = buffer.readUInt32LE(pos + 18)
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString('utf8')
    const dataStart = pos + 30 + nameLen + extraLen

    if (name.endsWith('/')) {
      const dirPath = path.join(outDir, name)
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
    } else {
      const filePath = path.join(outDir, name)
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(filePath, buffer.slice(dataStart, dataStart + compSize))
    }

    pos = dataStart + compSize
  }
}
