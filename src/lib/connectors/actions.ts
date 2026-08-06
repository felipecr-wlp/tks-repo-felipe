import 'server-only'
import { z } from 'zod'
import type { createAdminClient } from '@/lib/supabase/server'

/**
 * Registro de acciones que WLO expone como proveedor del contrato de conectores.
 *
 * Cada accion declara: el scope que exige (o null si es de prueba), un esquema Zod
 * del payload, y un handler que reusa la logica interna que ya existe. El endpoint
 * /api/connectors/[...action] valida token + scope y despacha aqui.
 *
 * Este registro es la referencia del patron. WLI y WLM tendran su propio registro
 * equivalente en sus repos (leads:create, bid:review, etc.).
 */

type Admin = ReturnType<typeof createAdminClient>

export interface ActionContext {
  admin: Admin
  workspaceId: string | null
  callerApp: string | null
}

export interface ActionDef {
  scope: string | null
  schema: z.ZodTypeAny
  handler: (payload: unknown, ctx: ActionContext) => Promise<unknown>
}

// ── ping: prueba de extremo a extremo sin efectos secundarios ─────────────────
const pingAction: ActionDef = {
  scope: null,
  schema: z.object({ echo: z.string().max(500).optional() }).default({}),
  handler: async (payload) => {
    const { echo } = payload as { echo?: string }
    return { pong: true, echo: echo ?? null, at: new Date().toISOString() }
  },
}

// ── notes/create: accion real de referencia (esquema conocido) ────────────────
const notesCreateSchema = z.object({
  workspace_id: z.string().uuid(),
  title: z.string().max(200).trim().optional(),
  content: z.string().max(200_000).nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(['private', 'space', 'workspace']).default('workspace'),
})

const notesCreateAction: ActionDef = {
  scope: 'notes:create',
  schema: notesCreateSchema,
  handler: async (payload) => {
    const p = payload as z.infer<typeof notesCreateSchema>
    // Import diferido para no cargar el sanitizador si la accion no se usa.
    const { sanitizeRichText } = await import('@/lib/sanitize')
    const { createAdminClient } = await import('@/lib/supabase/server')
    const admin = createAdminClient()

    const { data, error } = (await admin
      .from('notes')
      .insert({
        workspace_id: p.workspace_id,
        space_id: p.space_id ?? null,
        title: p.title ?? 'Nota de conector',
        content: p.content == null ? null : sanitizeRichText(p.content),
        visibility: p.visibility,
        doc_kind: 'note',
        created_by: null, // creada por un sistema, no por una persona
      })
      .select('id, title, visibility, created_at')
      .single()) as { data: { id: string } | null; error: unknown }

    if (error || !data) throw new Error('No se pudo crear la nota')
    return { note_id: data.id }
  },
}

// ── workspace/read: datos basicos del workspace sin exponer miembros ─────────
const workspaceReadAction: ActionDef = {
  scope: 'workspace:read',
  schema: z.object({}).default({}),
  handler: async (_payload, ctx) => {
    if (!ctx.workspaceId) throw new Error('workspace_id requerido')
    const { createAdminClient } = await import('@/lib/supabase/server')
    const admin = createAdminClient()
    const { data, error } = (await admin
      .from('workspaces')
      .select('id, name, slug')
      .eq('id', ctx.workspaceId)
      .single()) as { data: { id: string; name: string; slug: string } | null; error: unknown }
    if (error || !data) throw new Error('Workspace no encontrado')
    return { workspace: data }
  },
}

// ── workspace/members: lista de miembros del workspace ──────────────────────
const workspaceMembersAction: ActionDef = {
  scope: 'workspace:members',
  schema: z.object({}).default({}),
  handler: async (_payload, ctx) => {
    if (!ctx.workspaceId) throw new Error('workspace_id requerido')
    const { createAdminClient } = await import('@/lib/supabase/server')
    const admin = createAdminClient()
    const { data, error } = (await admin
      .from('workspace_members')
      .select('profile_id, role, profiles ( id, display_name, email )')
      .eq('workspace_id', ctx.workspaceId)) as {
      data: { profile_id: string; role: string; profiles: { id: string; display_name: string | null; email: string | null } | null }[] | null
      error: unknown
    }
    if (error) throw new Error('No se pudieron leer los miembros')
    const members = (data ?? []).map(m => ({
      id: m.profile_id,
      name: m.profiles?.display_name ?? m.profiles?.email ?? m.profile_id,
      role: m.role,
    }))
    return { members }
  },
}

export const WLO_ACTIONS: Record<string, ActionDef> = {
  ping: pingAction,
  'notes/create': notesCreateAction,
  'workspace/read': workspaceReadAction,
  'workspace/members': workspaceMembersAction,
}

export function getAction(actionPath: string): ActionDef | undefined {
  return WLO_ACTIONS[actionPath]
}
