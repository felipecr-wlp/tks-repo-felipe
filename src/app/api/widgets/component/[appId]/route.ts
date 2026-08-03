import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'

interface RouteParams { params: { appId: string } }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const pluginDir = path.join(process.cwd(), 'plugins', params.appId)
  const pageFile = path.join(pluginDir, 'page.js')

  if (!fs.existsSync(pageFile)) {
    return NextResponse.json({ error: 'Componente no encontrado' }, { status: 404 })
  }

  const code = fs.readFileSync(pageFile, 'utf8')
  return new NextResponse(code, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  })
}
