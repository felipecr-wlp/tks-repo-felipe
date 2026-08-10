// Tipos generados de Supabase (prod cmskiyypeujcgikbvyoz). Regenerar con el MCP generate_typescript_types. NO editar a mano las tablas.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academy_access: {
        Row: {
          course_id: string
          granted_at: string
          granted_by: string | null
          id: string
          profile_id: string
        }
        Insert: {
          course_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          profile_id: string
        }
        Update: {
          course_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_access_requests: {
        Row: {
          course_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          profile_id: string
          status: string
        }
        Insert: {
          course_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          profile_id: string
          status?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          profile_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_access_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_access_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_certificates: {
        Row: {
          code: string
          course_id: string
          id: string
          issued_at: string
          profile_id: string
          score: number
        }
        Insert: {
          code: string
          course_id: string
          id?: string
          issued_at?: string
          profile_id: string
          score?: number
        }
        Update: {
          code?: string
          course_id?: string
          id?: string
          issued_at?: string
          profile_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "academy_certificates_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_custom_courses: {
        Row: {
          accent: string
          author_id: string | null
          cert_name: string
          course_id: string
          created_at: string
          icon: string
          id: string
          lang: string
          modules: Json
          published_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          subtitle: string
          title: string
          track: string
          updated_at: string
        }
        Insert: {
          accent?: string
          author_id?: string | null
          cert_name?: string
          course_id: string
          created_at?: string
          icon?: string
          id?: string
          lang?: string
          modules?: Json
          published_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          subtitle?: string
          title: string
          track?: string
          updated_at?: string
        }
        Update: {
          accent?: string
          author_id?: string | null
          cert_name?: string
          course_id?: string
          created_at?: string
          icon?: string
          id?: string
          lang?: string
          modules?: Json
          published_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          subtitle?: string
          title?: string
          track?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_custom_courses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_custom_courses_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_progress: {
        Row: {
          completed: boolean
          course_id: string
          id: string
          module_id: string
          profile_id: string
          score: number
          updated_at: string
        }
        Insert: {
          completed?: boolean
          course_id: string
          id?: string
          module_id: string
          profile_id: string
          score?: number
          updated_at?: string
        }
        Update: {
          completed?: boolean
          course_id?: string
          id?: string
          module_id?: string
          profile_id?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_progress_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_video_progress: {
        Row: {
          completed: boolean
          id: string
          last_position: number
          profile_id: string
          seconds_watched: number
          updated_at: string
          video_id: string
        }
        Insert: {
          completed?: boolean
          id?: string
          last_position?: number
          profile_id: string
          seconds_watched?: number
          updated_at?: string
          video_id: string
        }
        Update: {
          completed?: boolean
          id?: string
          last_position?: number
          profile_id?: string
          seconds_watched?: number
          updated_at?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_video_progress_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_video_progress_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "academy_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_schools: {
        Row: {
          accent: string
          code: string
          created_at: string
          description: string
          id: string
          mandatory: boolean
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          accent?: string
          code: string
          created_at?: string
          description?: string
          id?: string
          mandatory?: boolean
          position?: number
          title: string
          updated_at?: string
        }
        Update: {
          accent?: string
          code?: string
          created_at?: string
          description?: string
          id?: string
          mandatory?: boolean
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      academy_stacks: {
        Row: {
          accent: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          position: number
          school_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accent?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          position?: number
          school_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accent?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          position?: number
          school_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_stacks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_videos: {
        Row: {
          chapters: Json
          created_at: string
          created_by: string | null
          description: string
          duration_seconds: number | null
          id: string
          interactions: Json
          stack_id: string | null
          status: string
          storage_path: string
          tags: string[]
          thumbnail_path: string | null
          title: string
          updated_at: string
        }
        Insert: {
          chapters?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          duration_seconds?: number | null
          id?: string
          interactions?: Json
          stack_id?: string | null
          status?: string
          storage_path: string
          tags?: string[]
          thumbnail_path?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          chapters?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          duration_seconds?: number | null
          id?: string
          interactions?: Json
          stack_id?: string | null
          status?: string
          storage_path?: string
          tags?: string[]
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_videos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academy_videos_stack_id_fkey"
            columns: ["stack_id"]
            isOneToOne: false
            referencedRelation: "academy_stacks"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          created_at: string
          id: string
          is_superseded: boolean
          metadata: Json | null
          object_id: string
          object_title: string | null
          object_type: string
          project_id: string | null
          subject_id: string | null
          verb: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_superseded?: boolean
          metadata?: Json | null
          object_id: string
          object_title?: string | null
          object_type: string
          project_id?: string | null
          subject_id?: string | null
          verb: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_superseded?: boolean
          metadata?: Json | null
          object_id?: string
          object_title?: string | null
          object_type?: string
          project_id?: string | null
          subject_id?: string | null
          verb?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mime_type: string | null
          name: string
          project_id: string | null
          size: number | null
          team_id: string | null
          url: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mime_type?: string | null
          name: string
          project_id?: string | null
          size?: number | null
          team_id?: string | null
          url: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string | null
          size?: number | null
          team_id?: string | null
          url?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          actions: Json
          conditions: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          project_id: string
          trigger: string
          trigger_config: Json
          updated_at: string
          workspace_id: string
        }
        Insert: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          project_id: string
          trigger: string
          trigger_config?: Json
          updated_at?: string
          workspace_id: string
        }
        Update: {
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          project_id?: string
          trigger?: string
          trigger_config?: Json
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_apps: {
        Row: {
          base_url: string
          created_at: string
          description: string | null
          embed_path: string | null
          icon: string | null
          id: string
          kind: string
          name: string
          owner_profile_id: string | null
          requested_scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          base_url: string
          created_at?: string
          description?: string | null
          embed_path?: string | null
          icon?: string | null
          id: string
          kind?: string
          name: string
          owner_profile_id?: string | null
          requested_scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          base_url?: string
          created_at?: string
          description?: string | null
          embed_path?: string | null
          icon?: string | null
          id?: string
          kind?: string
          name?: string
          owner_profile_id?: string | null
          requested_scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      connector_call_log: {
        Row: {
          action: string | null
          caller_app: string | null
          created_at: string
          id: number
          key_id: string | null
          scope: string | null
          status: number | null
          target_app: string | null
          workspace_id: string | null
        }
        Insert: {
          action?: string | null
          caller_app?: string | null
          created_at?: string
          id?: never
          key_id?: string | null
          scope?: string | null
          status?: number | null
          target_app?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string | null
          caller_app?: string | null
          created_at?: string
          id?: never
          key_id?: string | null
          scope?: string | null
          status?: number | null
          target_app?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connector_call_log_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "connector_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_call_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_installs: {
        Row: {
          app_id: string
          enabled: boolean
          granted_scopes: string[]
          id: string
          installed_at: string
          installed_by: string | null
          manifest: Json
          token_expires_at: string | null
          token_hash: string | null
          token_prefix: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          app_id: string
          enabled?: boolean
          granted_scopes?: string[]
          id?: string
          installed_at?: string
          installed_by?: string | null
          manifest?: Json
          token_expires_at?: string | null
          token_hash?: string | null
          token_prefix?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          app_id?: string
          enabled?: boolean
          granted_scopes?: string[]
          id?: string
          installed_at?: string
          installed_by?: string | null
          manifest?: Json
          token_expires_at?: string | null
          token_hash?: string | null
          token_prefix?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_installs_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "connector_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_installs_installed_by_fkey"
            columns: ["installed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_installs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_keys: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          target_app: string
          token_hash: string
          token_prefix: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          target_app: string
          token_hash: string
          token_prefix: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          target_app?: string
          token_hash?: string
          token_prefix?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_keys_target_app_fkey"
            columns: ["target_app"]
            isOneToOne: false
            referencedRelation: "connector_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          event: string
          id: string
          secret: string
          source_app: string
          target_url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          event: string
          id?: string
          secret: string
          source_app: string
          target_url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          event?: string
          id?: string
          secret?: string
          source_app?: string
          target_url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_webhooks_source_app_fkey"
            columns: ["source_app"]
            isOneToOne: false
            referencedRelation: "connector_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_webhooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_assets: {
        Row: {
          bytes: number
          created_at: string
          height: number | null
          id: string
          item_id: string
          path: string
          position: number
          thumb_bytes: number
          thumb_path: string
          width: number | null
        }
        Insert: {
          bytes: number
          created_at?: string
          height?: number | null
          id?: string
          item_id: string
          path: string
          position?: number
          thumb_bytes: number
          thumb_path: string
          width?: number | null
        }
        Update: {
          bytes?: number
          created_at?: string
          height?: number | null
          id?: string
          item_id?: string
          path?: string
          position?: number
          thumb_bytes?: number
          thumb_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_assets_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          caption: string | null
          created_at: string
          created_by: string | null
          format: string | null
          id: string
          network: string
          published_at: string | null
          published_url: string | null
          rating: number | null
          scheduled_for: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          format?: string | null
          id?: string
          network: string
          published_at?: string | null
          published_url?: string | null
          rating?: number | null
          scheduled_for?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          format?: string | null
          id?: string
          network?: string
          published_at?: string | null
          published_url?: string | null
          rating?: number | null
          scheduled_for?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          item_id: string
          kind: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          item_id: string
          kind?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          item_id?: string
          kind?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_notes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_notes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          field_type: string
          id: string
          name: string
          options: Json
          position: number
          project_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_type: string
          id?: string
          name: string
          options?: Json
          position?: number
          project_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_type?: string
          id?: string
          name?: string
          options?: Json
          position?: number
          project_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_definitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_definitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_digests: {
        Row: {
          content: string
          created_at: string
          generated_by: string | null
          id: string
          period: string
          period_end: string
          period_start: string
          profile_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string
          generated_by?: string | null
          id?: string
          period: string
          period_end: string
          period_start: string
          profile_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          generated_by?: string | null
          id?: string
          period?: string
          period_end?: string
          period_start?: string
          profile_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_digests_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_digests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_digests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_entries: {
        Row: {
          category: string
          content: string
          created_at: string
          details: string | null
          id: string
          minutes: number | null
          report_id: string
          resolved_at: string | null
          source: string
          task_id: string | null
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          details?: string | null
          id?: string
          minutes?: number | null
          report_id: string
          resolved_at?: string | null
          source?: string
          task_id?: string | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          details?: string | null
          id?: string
          minutes?: number | null
          report_id?: string
          resolved_at?: string | null
          source?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_images: {
        Row: {
          bytes: number
          caption: string | null
          created_at: string
          entry_id: string
          height: number | null
          id: string
          path: string
          report_id: string
          thumb_bytes: number
          thumb_path: string
          width: number | null
        }
        Insert: {
          bytes: number
          caption?: string | null
          created_at?: string
          entry_id: string
          height?: number | null
          id?: string
          path: string
          report_id: string
          thumb_bytes: number
          thumb_path: string
          width?: number | null
        }
        Update: {
          bytes?: number
          caption?: string | null
          created_at?: string
          entry_id?: string
          height?: number | null
          id?: string
          path?: string
          report_id?: string
          thumb_bytes?: number
          thumb_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_images_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "daily_report_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          report_date: string
          status: string
          submitted_at: string | null
          summary: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          report_date: string
          status?: string
          submitted_at?: string | null
          summary?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          report_date?: string
          status?: string
          submitted_at?: string | null
          summary?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_shares: {
        Row: {
          created_at: string
          flow_id: string
          id: string
          permission: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          flow_id: string
          id?: string
          permission?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          flow_id?: string
          id?: string
          permission?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_shares_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_shares_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          edges: Json
          id: string
          nodes: Json
          project_id: string | null
          title: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          id?: string
          nodes?: Json
          project_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edges?: Json
          id?: string
          nodes?: Json
          project_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_tasks: {
        Row: {
          created_at: string
          goal_id: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          goal_id: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          created_by: string | null
          current_value: number
          description: string | null
          due_date: string | null
          id: string
          owner_id: string | null
          progress_mode: string
          status: string
          target_value: number
          title: string
          unit: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_value?: number
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          progress_mode?: string
          status?: string
          target_value?: number
          title: string
          unit?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_value?: number
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string | null
          progress_mode?: string
          status?: string
          target_value?: number
          title?: string
          unit?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      google_connections: {
        Row: {
          access_token: string
          created_at: string
          email: string | null
          google_user_id: string | null
          id: string
          profile_id: string
          refresh_token: string | null
          scopes: string[]
          token_expiry: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          email?: string | null
          google_user_id?: string | null
          id?: string
          profile_id: string
          refresh_token?: string | null
          scopes?: string[]
          token_expiry?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          email?: string | null
          google_user_id?: string | null
          id?: string
          profile_id?: string
          refresh_token?: string | null
          scopes?: string[]
          token_expiry?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_connections_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          project_id: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          project_id: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          profile_id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          profile_id: string
          project_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          profile_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "project_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          author_id: string
          body: string
          created_at: string
          id: string
          team_id: string
          workspace_id: string | null
        }
        Insert: {
          attachments?: Json
          author_id: string
          body: string
          created_at?: string
          id?: string
          team_id: string
          workspace_id?: string | null
        }
        Update: {
          attachments?: Json
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          team_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_acknowledgements: {
        Row: {
          acknowledged_at: string
          id: string
          note_id: string
          profile_id: string
          sop_version: string | null
          workspace_id: string
        }
        Insert: {
          acknowledged_at?: string
          id?: string
          note_id: string
          profile_id: string
          sop_version?: string | null
          workspace_id: string
        }
        Update: {
          acknowledged_at?: string
          id?: string
          note_id?: string
          profile_id?: string
          sop_version?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_acknowledgements_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_acknowledgements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_acknowledgements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          note_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          note_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          note_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_comments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_links: {
        Row: {
          created_at: string
          id: string
          source_note_id: string
          target_note_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_note_id: string
          target_note_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source_note_id?: string
          target_note_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_links_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_target_note_id_fkey"
            columns: ["target_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      note_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_by: string
          mentioned_id: string
          note_id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_by: string
          mentioned_id: string
          note_id: string
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_by?: string
          mentioned_id?: string
          note_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_mentions_mentioned_by_fkey"
            columns: ["mentioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_mentioned_id_fkey"
            columns: ["mentioned_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_versions: {
        Row: {
          content: string | null
          created_at: string
          edited_by: string | null
          id: string
          note_id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          edited_by?: string | null
          id?: string
          note_id: string
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          edited_by?: string | null
          id?: string
          note_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_versions_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_versions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_version: string | null
          content: string | null
          cover: string | null
          created_at: string
          created_by: string | null
          doc_kind: string
          icon: string | null
          id: string
          parent_note_id: string | null
          project_id: string | null
          review_due: string | null
          sop_status: string | null
          sop_version: string | null
          space_id: string | null
          title: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_version?: string | null
          content?: string | null
          cover?: string | null
          created_at?: string
          created_by?: string | null
          doc_kind?: string
          icon?: string | null
          id?: string
          parent_note_id?: string | null
          project_id?: string | null
          review_due?: string | null
          sop_status?: string | null
          sop_version?: string | null
          space_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_version?: string | null
          content?: string | null
          cover?: string | null
          created_at?: string
          created_by?: string | null
          doc_kind?: string
          icon?: string | null
          id?: string
          parent_note_id?: string | null
          project_id?: string | null
          review_due?: string | null
          sop_status?: string | null
          sop_version?: string | null
          space_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_parent_note_id_fkey"
            columns: ["parent_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          object_id: string | null
          object_title: string | null
          object_type: string | null
          recipient_id: string
          snoozed_until: string | null
          subject_id: string | null
          type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          object_id?: string | null
          object_title?: string | null
          object_type?: string | null
          recipient_id: string
          snoozed_until?: string | null
          subject_id?: string | null
          type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          object_id?: string | null
          object_title?: string | null
          object_type?: string | null
          recipient_id?: string
          snoozed_until?: string | null
          subject_id?: string | null
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      org_email_domains: {
        Row: {
          created_at: string
          domain: string
          org_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          org_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_email_domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          profile_id: string
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          profile_id: string
          role?: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_workspace_id: string | null
          email_domain: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_workspace_id?: string | null
          email_domain?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_workspace_id?: string | null
          email_domain?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          email_notifications: boolean
          id: string
          org_id: string | null
          org_role: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_notifications?: boolean
          id: string
          org_id?: string | null
          org_role?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_notifications?: boolean
          id?: string
          org_id?: string | null
          org_role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_applications: {
        Row: {
          applicant_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          pitch: string
          project_id: string
          role_desired: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          applicant_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          pitch: string
          project_id: string
          role_desired?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          applicant_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          pitch?: string
          project_id?: string
          role_desired?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_applications_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_applications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          contribution: string | null
          created_at: string
          id: string
          joined_at: string
          profile_id: string
          project_id: string
          role: string
          title: string | null
        }
        Insert: {
          contribution?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          profile_id: string
          project_id: string
          role?: string
          title?: string | null
        }
        Update: {
          contribution?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          profile_id?: string
          project_id?: string
          role?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_messages: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          project_id: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          project_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          project_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_reviews: {
        Row: {
          collaboration: number
          comment: string | null
          communication: number
          created_at: string
          id: string
          project_id: string
          quality: number
          reliability: number
          reviewee_id: string
          reviewer_id: string
          workspace_id: string
        }
        Insert: {
          collaboration: number
          comment?: string | null
          communication: number
          created_at?: string
          id?: string
          project_id: string
          quality: number
          reliability: number
          reviewee_id: string
          reviewer_id: string
          workspace_id: string
        }
        Update: {
          collaboration?: number
          comment?: string | null
          communication?: number
          created_at?: string
          id?: string
          project_id?: string
          quality?: number
          reliability?: number
          reviewee_id?: string
          reviewer_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_reviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          application_deadline: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          deliverables: string | null
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean
          lead_id: string | null
          max_members: number | null
          name: string
          open_for_applications: boolean
          rules: string | null
          scope: string | null
          slug: string
          status: string
          team_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          application_deadline?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deliverables?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          lead_id?: string | null
          max_members?: number | null
          name: string
          open_for_applications?: boolean
          rules?: string | null
          scope?: string | null
          slug: string
          status?: string
          team_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          application_deadline?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          deliverables?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          lead_id?: string | null
          max_members?: number | null
          name?: string
          open_for_applications?: boolean
          rules?: string | null
          scope?: string | null
          slug?: string
          status?: string
          team_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          body: string
          created_at: string
          creator_id: string
          id: string
          message_id: string | null
          remind_at: string
          sent_at: string | null
          status: string
          target_id: string
          team_id: string | null
          workspace_id: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          creator_id: string
          id?: string
          message_id?: string | null
          remind_at: string
          sent_at?: string | null
          status?: string
          target_id: string
          team_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          creator_id?: string
          id?: string
          message_id?: string | null
          remind_at?: string
          sent_at?: string | null
          status?: string
          target_id?: string
          team_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          note_id: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          note_id: string
          target_id: string
          target_type: string
          workspace_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          note_id?: string
          target_id?: string
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_assignments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      space_members: {
        Row: {
          added_by: string | null
          joined_at: string
          profile_id: string
          role: string
          space_id: string
        }
        Insert: {
          added_by?: string | null
          joined_at?: string
          profile_id: string
          role?: string
          space_id: string
        }
        Update: {
          added_by?: string | null
          joined_at?: string
          profile_id?: string
          role?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "space_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "space_members_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      spaces: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean
          is_restricted: boolean
          name: string
          organization_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_restricted?: boolean
          name: string
          organization_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_restricted?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spaces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string | null
          goal: string | null
          id: string
          name: string
          start_date: string | null
          status: string
          team_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: string
          team_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: string
          team_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprints_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          created_at: string
          profile_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string
          id: string
          mime_type: string | null
          name: string
          project_id: string
          size: number | null
          task_id: string
          uploaded_by: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type?: string | null
          name: string
          project_id: string
          size?: number | null
          task_id: string
          uploaded_by: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string
          size?: number | null
          task_id?: string
          uploaded_by?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          checklist_id: string
          created_at: string
          id: string
          is_checked: boolean
          position: number
          task_id: string
          title: string
          updated_at: string
        }
        Insert: {
          checklist_id: string
          created_at?: string
          id?: string
          is_checked?: boolean
          position?: number
          task_id: string
          title: string
          updated_at?: string
        }
        Update: {
          checklist_id?: string
          created_at?: string
          id?: string
          is_checked?: boolean
          position?: number
          task_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "task_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklists: {
        Row: {
          created_at: string
          id: string
          position: number
          task_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          task_id: string
          title?: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklists_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          project_id: string
          task_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          project_id: string
          task_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          task_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_custom_field_values: {
        Row: {
          field_id: string
          id: string
          project_id: string
          task_id: string
          updated_at: string
          value: Json | null
        }
        Insert: {
          field_id: string
          id?: string
          project_id: string
          task_id: string
          updated_at?: string
          value?: Json | null
        }
        Update: {
          field_id?: string
          id?: string
          project_id?: string
          task_id?: string
          updated_at?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "task_custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_field_values_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_field_values_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          depends_on: string
          id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on: string
          id?: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          created_at: string
          label_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          label_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_labels_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_by: string
          mentioned_id: string
          source: string
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_by: string
          mentioned_id: string
          source?: string
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_by?: string
          mentioned_id?: string
          source?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_mentions_mentioned_by_fkey"
            columns: ["mentioned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mentions_mentioned_id_fkey"
            columns: ["mentioned_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mentions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_relations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          relation_type: string
          source_task_id: string
          target_task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          relation_type: string
          source_task_id: string
          target_task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          relation_type?: string
          source_task_id?: string
          target_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_target_task_id_fkey"
            columns: ["target_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_saved_views: {
        Row: {
          created_at: string
          created_by: string | null
          filters: Json
          id: string
          is_shared: boolean
          name: string
          profile_id: string
          project_id: string
          sort: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
          profile_id: string
          project_id: string
          sort?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
          profile_id?: string
          project_id?: string
          sort?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_saved_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_saved_views_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      task_statuses: {
        Row: {
          category: string
          color: string | null
          created_at: string
          id: string
          name: string
          position: number
          project_id: string
        }
        Insert: {
          category?: string
          color?: string | null
          created_at?: string
          id?: string
          name: string
          position?: number
          project_id: string
        }
        Update: {
          category?: string
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_statuses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          checklist: Json
          created_at: string
          created_by: string | null
          description: string | null
          estimate_minutes: number | null
          id: string
          is_shared: boolean
          name: string
          priority: string
          project_id: string | null
          story_points: number | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          checklist?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_minutes?: number | null
          id?: string
          is_shared?: boolean
          name: string
          priority?: string
          project_id?: string | null
          story_points?: number | null
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          checklist?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimate_minutes?: number | null
          id?: string
          is_shared?: boolean
          name?: string
          priority?: string
          project_id?: string | null
          story_points?: number | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_watchers: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          project_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          project_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          project_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_watchers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          area: string | null
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          estimate_minutes: number | null
          id: string
          is_archived: boolean
          parent_task_id: string | null
          priority: string
          project_id: string
          recurrence_end_date: string | null
          recurrence_rule: string | null
          sort_order: string
          sprint_id: string | null
          start_date: string | null
          status_id: string | null
          story_points: number | null
          story_points_done: number | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          area?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimate_minutes?: number | null
          id?: string
          is_archived?: boolean
          parent_task_id?: string | null
          priority?: string
          project_id: string
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          sort_order: string
          sprint_id?: string | null
          start_date?: string | null
          status_id?: string | null
          story_points?: number | null
          story_points_done?: number | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          area?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimate_minutes?: number | null
          id?: string
          is_archived?: boolean
          parent_task_id?: string | null
          priority?: string
          project_id?: string
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          sort_order?: string
          sprint_id?: string | null
          start_date?: string | null
          status_id?: string | null
          story_points?: number | null
          story_points_done?: number | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "task_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          role: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          role?: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          role?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          profile_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          profile_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          profile_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_message_reactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          methodology: string
          name: string
          slug: string
          space_id: string | null
          updated_at: string
          wip_limits: Json | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          methodology?: string
          name: string
          slug: string
          space_id?: string | null
          updated_at?: string
          wip_limits?: Json | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          methodology?: string
          name?: string
          slug?: string
          space_id?: string | null
          updated_at?: string
          wip_limits?: Json | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_space_workspace_fkey"
            columns: ["space_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_comments: {
        Row: {
          attachments: Json
          author_id: string | null
          body: string
          created_at: string
          edited_at: string | null
          id: string
          is_system: boolean
          parent_id: string | null
          ticket_id: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_system?: boolean
          parent_id?: string | null
          ticket_id: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_system?: boolean
          parent_id?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ticket_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_watchers: {
        Row: {
          added_by: string | null
          created_at: string
          profile_id: string
          ticket_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          profile_id: string
          ticket_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          profile_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_watchers_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_watchers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_watchers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          assignee_id: string | null
          attachments: Json
          body: string | null
          closed_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          due_date: string | null
          id: string
          kind: string
          links: Json
          needed_by: string | null
          numero: number
          priority: string
          requested_by: string | null
          space_id: string | null
          status: string
          task_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignee_id?: string | null
          attachments?: Json
          body?: string | null
          closed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          due_date?: string | null
          id?: string
          kind?: string
          links?: Json
          needed_by?: string | null
          numero?: number
          priority?: string
          requested_by?: string | null
          space_id?: string | null
          status?: string
          task_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignee_id?: string | null
          attachments?: Json
          body?: string | null
          closed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          due_date?: string | null
          id?: string
          kind?: string
          links?: Json
          needed_by?: string | null
          numero?: number
          priority?: string
          requested_by?: string | null
          space_id?: string | null
          status?: string
          task_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          created_at: string
          duration_sec: number | null
          ended_at: string | null
          id: string
          note: string | null
          profile_id: string
          project_id: string
          started_at: string
          task_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          note?: string | null
          profile_id: string
          project_id: string
          started_at: string
          task_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          note?: string | null
          profile_id?: string
          project_id?: string
          started_at?: string
          task_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whiteboards: {
        Row: {
          content: string | null
          created_at: string
          created_by: string | null
          id: string
          note_id: string | null
          project_id: string | null
          space_id: string | null
          title: string
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note_id?: string | null
          project_id?: string | null
          space_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          note_id?: string | null
          project_id?: string | null
          space_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whiteboards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboards_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboards_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whiteboards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          password_hash: string | null
          revoked_at: string | null
          role: string
          uses_count: number
          workspace_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          password_hash?: string | null
          revoked_at?: string | null
          role?: string
          uses_count?: number
          workspace_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          password_hash?: string | null
          revoked_at?: string | null
          role?: string
          uses_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          hidden_features: string[]
          id: string
          profile_id: string
          role: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          hidden_features?: string[]
          id?: string
          profile_id: string
          role?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          hidden_features?: string[]
          id?: string
          profile_id?: string
          role?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          profile_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          profile_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          profile_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "workspace_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_reactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_message_reactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_messages: {
        Row: {
          attachments: Json | null
          author_id: string
          body: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          attachments?: Json | null
          author_id: string
          body: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          attachments?: Json | null
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          description: string | null
          id: string
          installed_features: string[]
          name: string
          org_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          installed_features?: string[]
          name: string
          org_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          installed_features?: string[]
          name?: string
          org_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_id: { Args: never; Returns: string }
      can_post_workspace_message: {
        Args: { p_profile: string; p_workspace: string }
        Returns: boolean
      }
      can_see_team: { Args: { p_team: string }; Returns: boolean }
      create_default_statuses: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      es_involucrado_en_solicitud: { Args: { t_id: string }; Returns: boolean }
      is_space_admin: { Args: { sp_id: string }; Returns: boolean }
      is_space_member: { Args: { sp_id: string }; Returns: boolean }
      is_team_admin: { Args: { p_team: string }; Returns: boolean }
      is_team_member: { Args: { p_team: string }; Returns: boolean }
      note_ancestors: {
        Args: { p_note_id: string }
        Returns: {
          depth: number
          icon: string
          id: string
          parent_note_id: string
          title: string
        }[]
      }
      profile_reputation: {
        Args: { p_profile_id: string }
        Returns: {
          avg_collaboration: number
          avg_communication: number
          avg_overall: number
          avg_quality: number
          avg_reliability: number
          review_count: number
        }[]
      }
      puede_ver_solicitud: { Args: { t_id: string }; Returns: boolean }
      redeem_invite_slot: { Args: { p_invite_id: string }; Returns: number }
      release_invite_slot: { Args: { p_invite_id: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sprint_burndown: {
        Args: { p_sprint_id: string }
        Returns: {
          actual_remaining: number
          day: string
          ideal_remaining: number
        }[]
      }
      user_admin_team_ids: { Args: never; Returns: string[] }
      user_admin_workspace_ids: { Args: never; Returns: string[] }
      user_manager_project_ids: { Args: never; Returns: string[] }
      user_project_ids: { Args: never; Returns: string[] }
      user_workspace_ids: { Args: never; Returns: string[] }
      workspace_cycle_time: {
        Args: { p_days?: number; p_workspace_id: string }
        Returns: {
          avg_days: number
          median_days: number
          sample: number
        }[]
      }
      workspace_dashboard_widgets: {
        Args: {
          p_in7: string
          p_project_ids: string[]
          p_today: string
          p_workspace_id: string
        }
        Returns: Json
      }
      workspace_throughput_weekly: {
        Args: { p_weeks?: number; p_workspace_id: string }
        Returns: {
          points_done: number
          tasks_done: number
          week_start: string
        }[]
      }
      workspace_velocity: {
        Args: { p_limit?: number; p_workspace_id: string }
        Returns: {
          done_points: number
          end_date: string
          planned_points: number
          sprint_id: string
          sprint_name: string
          status: string
          tasks_done: number
          tasks_total: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// DE AQUI PARA ABAJO ES A MANO. EL GENERADOR NO LO PRODUCE.
// Al regenerar, el MCP devuelve el archivo COMPLETO y sobrescribe: si se pega
// tal cual, esta cola desaparece y con ella `Task`, `Profile` y compañia, que
// medio repo importa. El sintoma son cientos de "has no exported member" que no
// se parecen en nada a su causa. Volver a pegar esta cola al final.
// ─────────────────────────────────────────────────────────────────────────────

// `Tables`, `TablesInsert`, `TablesUpdate` y `Enums` ya NO se declaran aqui: el
// generador actual los emite el mismo, arriba, y en una version mas capaz (las
// suyas aceptan tambien `{ schema }`). Redeclararlas daba TS2300 "Duplicate
// identifier". Lo unico que sobrevive es el alias `InsertTables`, que el
// generador no produce y que el repo ya usa con ese nombre; se define sobre el
// tipo del generador para que no puedan divergir.
export type InsertTables<T extends keyof Database['public']['Tables']> =
  TablesInsert<T>

// Exportaciones nombradas para uso frecuente
export type Profile         = Tables<'profiles'>
export type Organization    = Tables<'organizations'>
export type Workspace       = Tables<'workspaces'>
export type WorkspaceMember = Tables<'workspace_members'>
export type Team            = Tables<'teams'>
export type Project         = Tables<'projects'>
export type ProjectStatus   = Tables<'task_statuses'>
export type Task            = Tables<'tasks'>
export type Sprint          = Tables<'sprints'>
export type TaskComment     = Tables<'task_comments'>
export type Note            = Tables<'notes'>
export type Whiteboard      = Tables<'whiteboards'>
export type Notification    = Tables<'notifications'>
export type ActivityEvent   = Tables<'activity_events'>
export type Label           = Tables<'labels'>
