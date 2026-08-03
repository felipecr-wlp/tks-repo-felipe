import * as fs from 'fs'
import * as path from 'path'

export interface PluginManifest {
  name: string
  id: string
  version: string
  type: 'page' | 'widget'
  icon: string
  description: string
  author: string
  wlo_version: string
  slots: string[]
  permissions?: string[]
  routes?: { path: string; label: string; labelKey: string }[]
  api?: { path: string; methods: string[] }[]
  migrations?: string[]
  tables?: string[]
  component?: string
}

const pluginsDir = path.join(process.cwd(), 'plugins')
const manifestCache = new Map<string, PluginManifest>()

export function scanPlugins(): PluginManifest[] {
  if (!fs.existsSync(pluginsDir)) return []
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
  const manifests: PluginManifest[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8')
      const manifest: PluginManifest = JSON.parse(raw)
      manifestCache.set(manifest.id, manifest)
      manifests.push(manifest)
    } catch {
      console.warn(`[plugin-registry] Error reading manifest for ${entry.name}`)
    }
  }

  return manifests
}

export function getPlugin(id: string): PluginManifest | null {
  if (manifestCache.has(id)) return manifestCache.get(id)!
  // Try to scan and find it
  const plugins = scanPlugins()
  return plugins.find(p => p.id === id) || null
}

export function getPluginRoutes(): { id: string; path: string; label: string; labelKey: string }[] {
  const plugins = scanPlugins()
  const routes: { id: string; path: string; label: string; labelKey: string }[] = []
  for (const p of plugins) {
    if (p.routes) {
      for (const r of p.routes) {
        routes.push({ id: p.id, ...r })
      }
    }
  }
  return routes
}
