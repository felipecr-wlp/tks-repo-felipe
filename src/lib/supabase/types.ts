/**
 * Tipos de la base de datos Supabase.
 * Regenerar con: npm run db:generate-types (cuando Supabase esté configurado)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; slug: string; logo_url: string | null; domain: string | null; plan: string; created_at: string; updated_at: string }
        Insert: { id?: string; name: string; slug: string; logo_url?: string | null; domain?: string | null; plan?: string }
        Update: { name?: string; slug?: string; logo_url?: string | null; domain?: string | null; plan?: string; updated_at?: string }
      }
      profiles: {
        Row: { id: string; organization_id: string; full_name: string; avatar_url: string | null; org_role: 'owner' | 'admin' | 'member'; timezone: string; created_at: string; updated_at: string }
        Insert: { id: string; organization_id: string; full_name?: string; avatar_url?: string | null; org_role?: 'owner' | 'admin' | 'member'; timezone?: string }
        Update: { full_name?: string; avatar_url?: string | null; org_role?: 'owner' | 'admin' | 'member'; timezone?: string; updated_at?: string }
      }
      workspaces: {
        Row: { id: string; organization_id: string; name: string; slug: string; description: string | null; icon: string | null; color: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; name: string; slug: string; description?: string | null; icon?: string | null; color?: string | null; created_by?: string | null }
        Update: { name?: string; slug?: string; description?: string | null; icon?: string | null; color?: string | null; updated_at?: string }
      }
      workspace_members: {
        Row: { workspace_id: string; profile_id: string; role: 'admin' | 'manager' | 'member' | 'viewer'; invited_by: string | null; joined_at: string }
        Insert: { workspace_id: string; profile_id: string; role?: 'admin' | 'manager' | 'member' | 'viewer'; invited_by?: string | null }
        Update: { role?: 'admin' | 'manager' | 'member' | 'viewer' }
      }
      teams: {
        Row: { id: string; workspace_id: string; organization_id: string; name: string; description: string | null; color: string | null; icon: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; workspace_id: string; organization_id: string; name: string; description?: string | null; color?: string | null; icon?: string | null; created_by?: string | null }
        Update: { name?: string; description?: string | null; color?: string | null; icon?: string | null; updated_at?: string }
      }
      team_members: {
        Row: { team_id: string; profile_id: string; role: 'admin' | 'manager' | 'member' | 'viewer'; joined_at: string }
        Insert: { team_id: string; profile_id: string; role?: 'admin' | 'manager' | 'member' | 'viewer' }
        Update: { role?: 'admin' | 'manager' | 'member' | 'viewer' }
      }
      projects: {
        Row: { id: string; workspace_id: string; organization_id: string; team_id: string | null; name: string; description: string | null; color: string | null; icon: string | null; status: 'active' | 'archived' | 'completed'; visibility: 'private' | 'team' | 'workspace'; start_date: string | null; due_date: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; workspace_id: string; organization_id: string; team_id?: string | null; name: string; description?: string | null; color?: string | null; icon?: string | null; status?: 'active' | 'archived' | 'completed'; visibility?: 'private' | 'team' | 'workspace'; start_date?: string | null; due_date?: string | null; created_by?: string | null }
        Update: { name?: string; description?: string | null; color?: string | null; icon?: string | null; status?: 'active' | 'archived' | 'completed'; visibility?: 'private' | 'team' | 'workspace'; start_date?: string | null; due_date?: string | null; updated_at?: string }
      }
      project_members: {
        Row: { project_id: string; profile_id: string; role: 'manager' | 'member' | 'viewer'; added_by: string | null; added_at: string }
        Insert: { project_id: string; profile_id: string; role?: 'manager' | 'member' | 'viewer'; added_by?: string | null }
        Update: { role?: 'manager' | 'member' | 'viewer' }
      }
      project_statuses: {
        Row: { id: string; project_id: string; name: string; color: string; category: 'todo' | 'in_progress' | 'done' | 'cancelled'; position: number; is_default: boolean; created_at: string }
        Insert: { id?: string; project_id: string; name: string; color?: string; category?: 'todo' | 'in_progress' | 'done' | 'cancelled'; position?: number; is_default?: boolean }
        Update: { name?: string; color?: string; category?: 'todo' | 'in_progress' | 'done' | 'cancelled'; position?: number; is_default?: boolean }
      }
      tasks: {
        Row: { id: string; organization_id: string; workspace_id: string; project_id: string; parent_task_id: string | null; status_id: string | null; title: string; description: Json | null; priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'; start_date: string | null; due_date: string | null; time_estimate_minutes: number | null; position: number; is_archived: boolean; sprint_id: string | null; story_points: number | null; story_points_done: number | null; area: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; workspace_id: string; project_id: string; parent_task_id?: string | null; status_id?: string | null; title: string; description?: Json | null; priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'; start_date?: string | null; due_date?: string | null; time_estimate_minutes?: number | null; position?: number; is_archived?: boolean; sprint_id?: string | null; story_points?: number | null; story_points_done?: number | null; area?: string | null; created_by?: string | null }
        Update: { parent_task_id?: string | null; status_id?: string | null; title?: string; description?: Json | null; priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'; start_date?: string | null; due_date?: string | null; time_estimate_minutes?: number | null; position?: number; is_archived?: boolean; sprint_id?: string | null; story_points?: number | null; story_points_done?: number | null; area?: string | null; updated_at?: string }
      }
      sprints: {
        Row: { id: string; workspace_id: string; team_id: string; name: string; goal: string | null; status: 'planning' | 'active' | 'completed'; start_date: string | null; end_date: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; workspace_id: string; team_id: string; name: string; goal?: string | null; status?: 'planning' | 'active' | 'completed'; start_date?: string | null; end_date?: string | null; created_by?: string | null }
        Update: { name?: string; goal?: string | null; status?: 'planning' | 'active' | 'completed'; start_date?: string | null; end_date?: string | null; updated_at?: string }
      }
      task_assignees: {
        Row: { task_id: string; profile_id: string; assigned_by: string | null; assigned_at: string }
        Insert: { task_id: string; profile_id: string; assigned_by?: string | null }
        Update: Record<string, never>
      }
      task_comments: {
        Row: { id: string; task_id: string; organization_id: string; author_id: string; content: Json; parent_comment_id: string | null; is_edited: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; task_id: string; organization_id: string; author_id: string; content: Json; parent_comment_id?: string | null; is_edited?: boolean }
        Update: { content?: Json; is_edited?: boolean; updated_at?: string }
      }
      task_checklists: {
        Row: { id: string; task_id: string; title: string; position: number; created_at: string }
        Insert: { id?: string; task_id: string; title?: string; position?: number }
        Update: { title?: string; position?: number }
      }
      task_checklist_items: {
        Row: { id: string; checklist_id: string; label: string; is_completed: boolean; completed_by: string | null; completed_at: string | null; position: number; created_at: string }
        Insert: { id?: string; checklist_id: string; label: string; is_completed?: boolean; position?: number }
        Update: { label?: string; is_completed?: boolean; completed_by?: string | null; completed_at?: string | null; position?: number }
      }
      task_dependencies: {
        Row: { id: string; task_id: string; depends_on_task_id: string; type: 'blocked_by' | 'duplicates'; created_by: string | null; created_at: string }
        Insert: { id?: string; task_id: string; depends_on_task_id: string; type?: 'blocked_by' | 'duplicates'; created_by?: string | null }
        Update: Record<string, never>
      }
      labels: {
        Row: { id: string; workspace_id: string; organization_id: string; name: string; color: string; created_by: string | null; created_at: string }
        Insert: { id?: string; workspace_id: string; organization_id: string; name: string; color?: string; created_by?: string | null }
        Update: { name?: string; color?: string }
      }
      task_labels: {
        Row: { task_id: string; label_id: string }
        Insert: { task_id: string; label_id: string }
        Update: Record<string, never>
      }
      notes: {
        Row: { id: string; organization_id: string; workspace_id: string; project_id: string | null; task_id: string | null; space_id: string | null; title: string; content: Json | null; visibility: 'private' | 'project' | 'team' | 'workspace'; is_archived: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; workspace_id: string; project_id?: string | null; task_id?: string | null; space_id?: string | null; title: string; content?: Json | null; visibility?: 'private' | 'project' | 'team' | 'workspace'; is_archived?: boolean; created_by?: string | null }
        Update: { title?: string; content?: Json | null; space_id?: string | null; visibility?: 'private' | 'project' | 'team' | 'workspace'; is_archived?: boolean; updated_at?: string }
      }
      spaces: {
        Row: { id: string; organization_id: string; workspace_id: string; name: string; description: string | null; icon: string | null; color: string | null; is_restricted: boolean; is_archived: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; workspace_id: string; name: string; description?: string | null; icon?: string | null; color?: string | null; is_restricted?: boolean; is_archived?: boolean; created_by?: string | null }
        Update: { name?: string; description?: string | null; icon?: string | null; color?: string | null; is_restricted?: boolean; is_archived?: boolean; updated_at?: string }
      }
      space_members: {
        Row: { space_id: string; profile_id: string; role: 'owner' | 'admin' | 'member'; added_by: string | null; joined_at: string }
        Insert: { space_id: string; profile_id: string; role?: 'owner' | 'admin' | 'member'; added_by?: string | null }
        Update: { role?: 'owner' | 'admin' | 'member' }
      }
      note_versions: {
        Row: { id: string; note_id: string; content: Json; title: string; saved_by: string | null; created_at: string }
        Insert: { id?: string; note_id: string; content: Json; title: string; saved_by?: string | null }
        Update: Record<string, never>
      }
      whiteboards: {
        Row: { id: string; organization_id: string; workspace_id: string; project_id: string | null; title: string; content: Json | null; visibility: 'private' | 'project' | 'team' | 'workspace'; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; organization_id: string; workspace_id: string; project_id?: string | null; title: string; content?: Json | null; visibility?: 'private' | 'project' | 'team' | 'workspace'; created_by?: string | null }
        Update: { title?: string; content?: Json | null; visibility?: 'private' | 'project' | 'team' | 'workspace'; updated_at?: string }
      }
      attachments: {
        Row: { id: string; organization_id: string; workspace_id: string; project_id: string | null; team_id: string | null; uploaded_by: string; storage_path: string; filename: string; content_type: string | null; size_bytes: number | null; visibility: 'private' | 'project' | 'team' | 'workspace'; parent_type: 'task' | 'comment' | 'note' | 'project'; parent_id: string; created_at: string }
        Insert: { id?: string; organization_id: string; workspace_id: string; project_id?: string | null; team_id?: string | null; uploaded_by: string; storage_path: string; filename: string; content_type?: string | null; size_bytes?: number | null; visibility?: 'private' | 'project' | 'team' | 'workspace'; parent_type: 'task' | 'comment' | 'note' | 'project'; parent_id: string }
        Update: { visibility?: 'private' | 'project' | 'team' | 'workspace' }
      }
      google_connections: {
        Row: { id: string; profile_id: string; google_user_id: string; access_token: string | null; refresh_token: string | null; token_expiry: string | null; scopes: string[]; created_at: string; updated_at: string }
        Insert: { id?: string; profile_id: string; google_user_id: string; access_token?: string | null; refresh_token?: string | null; token_expiry?: string | null; scopes?: string[] }
        Update: { access_token?: string | null; refresh_token?: string | null; token_expiry?: string | null; scopes?: string[]; updated_at?: string }
      }
      google_drive_links: {
        Row: { id: string; organization_id: string; created_by: string; drive_file_id: string; drive_file_name: string | null; drive_file_url: string | null; drive_thumbnail_url: string | null; drive_mime_type: string | null; parent_type: 'task' | 'note' | 'project'; parent_id: string; created_at: string }
        Insert: { id?: string; organization_id: string; created_by: string; drive_file_id: string; drive_file_name?: string | null; drive_file_url?: string | null; drive_thumbnail_url?: string | null; drive_mime_type?: string | null; parent_type: 'task' | 'note' | 'project'; parent_id: string }
        Update: { drive_file_name?: string | null; drive_thumbnail_url?: string | null }
      }
      google_sheet_links: {
        Row: { id: string; organization_id: string; created_by: string; spreadsheet_id: string; spreadsheet_name: string | null; sheet_name: string | null; embed_url: string | null; sync_range: string | null; last_synced_at: string | null; parent_type: 'task' | 'note' | 'project'; parent_id: string; created_at: string }
        Insert: { id?: string; organization_id: string; created_by: string; spreadsheet_id: string; spreadsheet_name?: string | null; sheet_name?: string | null; embed_url?: string | null; sync_range?: string | null; parent_type: 'task' | 'note' | 'project'; parent_id: string }
        Update: { spreadsheet_name?: string | null; sheet_name?: string | null; embed_url?: string | null; sync_range?: string | null; last_synced_at?: string | null }
      }
      activity_events: {
        Row: { id: string; organization_id: string; workspace_id: string | null; actor_id: string | null; verb: string; entity_type: string; entity_id: string; entity_title: string | null; metadata: Json | null; created_at: string }
        Insert: { id?: string; organization_id: string; workspace_id?: string | null; actor_id?: string | null; verb: string; entity_type: string; entity_id: string; entity_title?: string | null; metadata?: Json | null }
        Update: Record<string, never>
      }
      notifications: {
        Row: { id: string; organization_id: string; recipient_id: string; actor_id: string | null; type: string; entity_type: string | null; entity_id: string | null; entity_title: string | null; is_read: boolean; read_at: string | null; created_at: string }
        Insert: { id?: string; organization_id: string; recipient_id: string; actor_id?: string | null; type: string; entity_type?: string | null; entity_id?: string | null; entity_title?: string | null; is_read?: boolean }
        Update: { is_read?: boolean; read_at?: string | null }
      }
    }
    Views: Record<string, never>
    Functions: {
      auth_org_id: { Args: Record<never, never>; Returns: string }
      is_org_admin: { Args: Record<never, never>; Returns: boolean }
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean }
      is_project_member: { Args: { proj_id: string }; Returns: boolean }
    }
    Enums: {
      org_role: 'owner' | 'admin' | 'member'
      workspace_role: 'admin' | 'manager' | 'member' | 'viewer'
      project_role: 'manager' | 'member' | 'viewer'
      task_priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
      status_category: 'todo' | 'in_progress' | 'done' | 'cancelled'
      resource_visibility: 'private' | 'project' | 'team' | 'workspace'
      dependency_type: 'blocked_by' | 'duplicates'
    }
  }
}

// ── Tipos derivados útiles ───────────────────────────────────
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// Exportaciones nombradas para uso frecuente
export type Profile         = Tables<'profiles'>
export type Organization    = Tables<'organizations'>
export type Workspace       = Tables<'workspaces'>
export type WorkspaceMember = Tables<'workspace_members'>
export type Team            = Tables<'teams'>
export type Project         = Tables<'projects'>
export type ProjectStatus   = Tables<'project_statuses'>
export type Task            = Tables<'tasks'>
export type Sprint          = Tables<'sprints'>
export type TaskComment     = Tables<'task_comments'>
export type Note            = Tables<'notes'>
export type Whiteboard      = Tables<'whiteboards'>
export type Notification    = Tables<'notifications'>
export type ActivityEvent   = Tables<'activity_events'>
export type Label           = Tables<'labels'>
