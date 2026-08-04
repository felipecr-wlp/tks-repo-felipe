import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import * as fs from 'fs'
import * as path from 'path'

interface RouteParams { params: { pluginId: string } }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: install } = await admin
    .from('connector_installs')
    .select('app_id')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: { app_id: string } | null; error: unknown }

  const appId = install?.app_id || params.pluginId
  const pluginDir = path.join(process.cwd(), 'plugins', appId)

  let files: { name: string; content: Buffer }[] = []

  if (fs.existsSync(pluginDir)) {
    files = getFilesRecursive(pluginDir, '')
  }

  // Always include a manifest
  const manifestPath = path.join(pluginDir, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    void JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (!files.some(f => f.name === 'manifest.json')) {
      files.unshift({ name: 'manifest.json', content: fs.readFileSync(manifestPath) })
    }
  } else {
    const { data: catalog } = await admin
      .from('connector_apps')
      .select('name, icon')
      .eq('id', appId)
      .maybeSingle() as { data: { name: string; icon: string } | null; error: unknown }
    const manifest = JSON.stringify({
      name: catalog?.name ?? appId, id: appId, version: '1.0.0', type: 'widget',
      icon: catalog?.icon ?? 'puzzle', description: '', author: '', wlo_version: '>=1.0.0', slots: [],
    }, null, 2)
    files.push({ name: 'manifest.json', content: Buffer.from(manifest, 'utf8') })
  }

  const zip = createZip(files)
  return new NextResponse(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${appId}.wlo-plugin.zip"`,
    },
  })
}

function getFilesRecursive(dir: string, relativeBase: string): { name: string; content: Buffer }[] {
  const files: { name: string; content: Buffer }[] = []
  if (!fs.existsSync(dir)) return files
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relPath = relativeBase ? path.join(relativeBase, entry.name).replace(/\\/g, '/') : entry.name
    if (entry.isDirectory()) {
      files.push(...getFilesRecursive(fullPath, relPath))
    } else {
      files.push({ name: relPath, content: fs.readFileSync(fullPath) })
    }
  }
  return files
}

function createZip(files: { name: string; content: Buffer }[]) {
  const localFiles: Buffer[] = []
  const centralDir: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const content = file.content
    const crc = crc32(content)

    const localHeader = Buffer.alloc(30 + nameBytes.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(localHeader, 30)
    localFiles.push(localHeader, content)

    const cdEntry = Buffer.alloc(46 + nameBytes.length)
    cdEntry.writeUInt32LE(0x02014b50, 0)
    cdEntry.writeUInt16LE(20, 4); cdEntry.writeUInt16LE(20, 6)
    cdEntry.writeUInt32LE(crc, 16)
    cdEntry.writeUInt32LE(content.length, 20)
    cdEntry.writeUInt32LE(content.length, 24)
    cdEntry.writeUInt16LE(nameBytes.length, 28)
    cdEntry.writeUInt32LE(offset, 42)
    nameBytes.copy(cdEntry, 46)
    centralDir.push(cdEntry)

    offset += 30 + nameBytes.length + content.length
  }

  const cdOffset = offset
  const cdBuffer = Buffer.concat(centralDir)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuffer.length, 12)
  eocd.writeUInt32LE(cdOffset, 16)

  return Buffer.concat([...localFiles, cdBuffer, eocd])
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
