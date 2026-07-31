import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface RouteParams { params: { pluginId: string } }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: install } = await admin
    .from('connector_installs')
    .select('id, app_id, manifest, workspace_id')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: any; error: unknown }

  if (!install) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const { data: catalog } = await admin
    .from('connector_apps')
    .select('id, name, icon')
    .eq('id', install.app_id)
    .maybeSingle() as { data: { id: string; name: string; icon: string } | null; error: unknown }

  // Build manifest.json
  const manifest = {
    name: catalog?.name ?? install.app_id,
    id: install.app_id,
    version: '1.0.0',
    type: 'widget',
    icon: catalog?.icon ?? 'power',
    slots: install.manifest?.slots ?? ['sidebar-complementos'],
    description: `Plugin ${catalog?.name ?? install.app_id} para WLO Workspace`,
    author: 'WLO Team',
    wlo_version: '>=1.0.0',
  }

  // Build a zip manually with JSON
  const manifestStr = JSON.stringify(manifest, null, 2)
  const readmeStr = `# ${manifest.name}\n\nPlugin para WLO Workspace.\n\n## Slots\n${manifest.slots.map((s: string) => `- ${s}`).join('\n')}\n`

  // Simple ZIP structure with just manifest + readme (for testing)
  // Using a minimal ZIP implementation
  const encoder = new TextEncoder()
  const files: { name: string; content: Uint8Array }[] = [
    { name: 'manifest.json', content: encoder.encode(manifestStr) },
    { name: 'README.md', content: encoder.encode(readmeStr) },
    { name: 'plugin.js', content: encoder.encode(`// ${manifest.name} - WLO Plugin\n// Entry point\nconsole.log('${manifest.name} loaded');\n`) },
  ]

  const zip = createZip(files)
  return new NextResponse(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${install.app_id}.wlo-plugin.zip"`,
    },
  })
}

function createZip(files: { name: string; content: Uint8Array }[]) {
  const localFiles: Uint8Array[] = []
  const centralDir: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name)
    const content = file.content
    const crc = crc32(content)

    const localHeader = new Uint8Array(30 + nameBytes.length)
    const dv = new DataView(localHeader.buffer)
    dv.setUint32(0, 0x04034b50, true) // signature
    dv.setUint16(4, 20, true) // version
    dv.setUint16(6, 0, true) // flags
    dv.setUint16(8, 0, true) // compression (stored)
    dv.setUint16(10, 0, true) // mod time
    dv.setUint16(12, 0, true) // mod date
    dv.setUint32(14, crc, true)
    dv.setUint32(18, content.length, true) // compressed size
    dv.setUint32(22, content.length, true) // uncompressed size
    dv.setUint16(26, nameBytes.length, true)
    dv.setUint16(28, 0, true) // extra field length
    localHeader.set(nameBytes, 30)

    localFiles.push(localHeader, content)

    const cdEntry = new Uint8Array(46 + nameBytes.length)
    const cdv = new DataView(cdEntry.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true)
    cdv.setUint16(12, 0, true); cdv.setUint16(14, 0, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, content.length, true)
    cdv.setUint32(24, content.length, true)
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true)
    cdv.setUint16(34, 0, true); cdv.setUint32(36, 0, true)
    cdv.setUint32(42, offset, true)
    cdEntry.set(nameBytes, 46)
    centralDir.push(cdEntry)

    offset += 30 + nameBytes.length + content.length
  }

  const cdOffset = offset
  const cdView = new Uint8Array(centralDir.reduce((a, b) => a + b.length, 0))
  let cdPos = 0
  for (const entry of centralDir) { cdView.set(entry, cdPos); cdPos += entry.length }

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true); ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, cdView.length, true)
  ev.setUint32(16, cdOffset, true)
  ev.setUint16(20, 0, true)

  const total = offset + cdView.length + eocd.length
  const result = new Uint8Array(total)
  let pos = 0
  for (const f of localFiles) { result.set(f, pos); pos += f.length }
  result.set(cdView, pos); pos += cdView.length
  result.set(eocd, pos)
  return result
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
