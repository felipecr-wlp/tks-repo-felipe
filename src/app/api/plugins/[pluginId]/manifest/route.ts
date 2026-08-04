import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

interface RouteParams { params: { pluginId: string } }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const manifestPath = path.join(process.cwd(), 'plugins', params.pluginId, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json({ error: 'Manifest no encontrado' }, { status: 404 })
  }

  return NextResponse.json(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}
