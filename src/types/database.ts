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
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          organization_id: string
          scopes: string[]
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          organization_id: string
          scopes?: string[]
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          scopes?: string[]
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          issue_id: string
          mime_type: string | null
          size_bytes: number
          storage_path: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          issue_id: string
          mime_type?: string | null
          size_bytes: number
          storage_path: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          issue_id?: string
          mime_type?: string | null
          size_bytes?: number
          storage_path?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          issue_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          issue_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          issue_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      components: {
        Row: {
          created_at: string
          default_assignee_id: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_assignee_id?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_assignee_id?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "components_default_assignee_id_fkey"
            columns: ["default_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          config: Json | null
          created_at: string
          field_type: string
          id: string
          is_required: boolean | null
          name: string
          project_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          field_type: string
          id?: string
          is_required?: boolean | null
          name: string
          project_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          field_type?: string
          id?: string
          is_required?: boolean | null
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      github_artifacts: {
        Row: {
          artifact_type: string
          author_login: string | null
          base_branch: string | null
          closed_at: string | null
          created_at: string
          draft: boolean
          external_key: string
          github_created_at: string | null
          github_id: number | null
          github_node_id: string | null
          github_repository_id: string
          github_updated_at: string | null
          head_branch: string | null
          head_sha: string | null
          html_url: string
          id: string
          last_synced_at: string
          merge_commit_sha: string | null
          merged: boolean
          merged_at: string | null
          number: number | null
          sha: string | null
          state: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          artifact_type: string
          author_login?: string | null
          base_branch?: string | null
          closed_at?: string | null
          created_at?: string
          draft?: boolean
          external_key: string
          github_created_at?: string | null
          github_id?: number | null
          github_node_id?: string | null
          github_repository_id: string
          github_updated_at?: string | null
          head_branch?: string | null
          head_sha?: string | null
          html_url: string
          id?: string
          last_synced_at?: string
          merge_commit_sha?: string | null
          merged?: boolean
          merged_at?: string | null
          number?: number | null
          sha?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          artifact_type?: string
          author_login?: string | null
          base_branch?: string | null
          closed_at?: string | null
          created_at?: string
          draft?: boolean
          external_key?: string
          github_created_at?: string | null
          github_id?: number | null
          github_node_id?: string | null
          github_repository_id?: string
          github_updated_at?: string | null
          head_branch?: string | null
          head_sha?: string | null
          html_url?: string
          id?: string
          last_synced_at?: string
          merge_commit_sha?: string | null
          merged?: boolean
          merged_at?: string | null
          number?: number | null
          sha?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_artifacts_github_repository_id_fkey"
            columns: ["github_repository_id"]
            isOneToOne: false
            referencedRelation: "github_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      github_installations: {
        Row: {
          created_at: string
          github_account_id: number
          github_account_login: string
          github_account_type: string
          github_installation_id: number
          id: string
          installed_by: string | null
          last_verified_at: string | null
          organization_id: string
          permissions: Json
          repository_selection: string
          status: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          github_account_id: number
          github_account_login: string
          github_account_type?: string
          github_installation_id: number
          id?: string
          installed_by?: string | null
          last_verified_at?: string | null
          organization_id: string
          permissions?: Json
          repository_selection?: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          github_account_id?: number
          github_account_login?: string
          github_account_type?: string
          github_installation_id?: number
          id?: string
          installed_by?: string | null
          last_verified_at?: string | null
          organization_id?: string
          permissions?: Json
          repository_selection?: string
          status?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_installations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      github_pr_check_summaries: {
        Row: {
          checks: Json
          completed_count: number
          created_at: string
          error: string | null
          failed_count: number
          github_artifact_id: string
          last_synced_at: string
          pending_count: number
          state: string
          successful_count: number
          total_count: number
          updated_at: string
        }
        Insert: {
          checks?: Json
          completed_count?: number
          created_at?: string
          error?: string | null
          failed_count?: number
          github_artifact_id: string
          last_synced_at?: string
          pending_count?: number
          state?: string
          successful_count?: number
          total_count?: number
          updated_at?: string
        }
        Update: {
          checks?: Json
          completed_count?: number
          created_at?: string
          error?: string | null
          failed_count?: number
          github_artifact_id?: string
          last_synced_at?: string
          pending_count?: number
          state?: string
          successful_count?: number
          total_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_pr_check_summaries_github_artifact_id_fkey"
            columns: ["github_artifact_id"]
            isOneToOne: true
            referencedRelation: "github_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      github_repositories: {
        Row: {
          archived: boolean
          created_at: string
          default_branch: string | null
          full_name: string
          github_repository_id: number
          html_url: string
          id: string
          installation_id: string
          is_accessible: boolean
          last_synced_at: string | null
          name: string
          owner_login: string
          private: boolean
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          default_branch?: string | null
          full_name: string
          github_repository_id: number
          html_url: string
          id?: string
          installation_id: string
          is_accessible?: boolean
          last_synced_at?: string | null
          name: string
          owner_login: string
          private?: boolean
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          default_branch?: string | null
          full_name?: string
          github_repository_id?: number
          html_url?: string
          id?: string
          installation_id?: string
          is_accessible?: boolean
          last_synced_at?: string | null
          name?: string
          owner_login?: string
          private?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_repositories_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      github_webhook_deliveries: {
        Row: {
          action: string | null
          attempt_count: number
          delivery_id: string
          error: string | null
          event_name: string
          github_installation_id: number | null
          github_repository_id: number | null
          id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          payload: Json
          payload_cleared_at: string | null
          processed_at: string | null
          processing_started_at: string | null
          received_at: string
          status: string
        }
        Insert: {
          action?: string | null
          attempt_count?: number
          delivery_id: string
          error?: string | null
          event_name: string
          github_installation_id?: number | null
          github_repository_id?: number | null
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          payload?: Json
          payload_cleared_at?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          action?: string | null
          attempt_count?: number
          delivery_id?: string
          error?: string | null
          event_name?: string
          github_installation_id?: number | null
          github_repository_id?: number | null
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          payload?: Json
          payload_cleared_at?: string | null
          processed_at?: string | null
          processing_started_at?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      issue_access: {
        Row: {
          created_at: string
          granted_by: string | null
          issue_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          issue_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          issue_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_access_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_custom_values: {
        Row: {
          custom_field_id: string
          issue_id: string
          value: Json
        }
        Insert: {
          custom_field_id: string
          issue_id: string
          value: Json
        }
        Update: {
          custom_field_id?: string
          issue_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "issue_custom_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_custom_values_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          field_name: string | null
          id: string
          issue_id: string
          metadata: Json | null
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          field_name?: string | null
          id?: string
          issue_id: string
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          field_name?: string | null
          id?: string
          issue_id?: string
          metadata?: Json | null
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_events_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_github_links: {
        Row: {
          created_at: string
          created_by: string | null
          github_artifact_id: string | null
          id: string
          issue_id: string
          link_type: string
          number: number | null
          relationship: string
          repo_name: string
          source: string
          status: string | null
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          github_artifact_id?: string | null
          id?: string
          issue_id: string
          link_type: string
          number?: number | null
          relationship?: string
          repo_name: string
          source?: string
          status?: string | null
          title?: string | null
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          github_artifact_id?: string | null
          id?: string
          issue_id?: string
          link_type?: string
          number?: number | null
          relationship?: string
          repo_name?: string
          source?: string
          status?: string | null
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_github_links_github_artifact_id_fkey"
            columns: ["github_artifact_id"]
            isOneToOne: false
            referencedRelation: "github_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_github_links_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_labels: {
        Row: {
          issue_id: string
          label_id: string
        }
        Insert: {
          issue_id: string
          label_id: string
        }
        Update: {
          issue_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_labels_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_links: {
        Row: {
          created_at: string
          created_by: string
          id: string
          relationship: string
          source_issue_id: string
          target_issue_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          relationship: string
          source_issue_id: string
          target_issue_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          relationship?: string
          source_issue_id?: string
          target_issue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_links_source_issue_id_fkey"
            columns: ["source_issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_links_target_issue_id_fkey"
            columns: ["target_issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_templates: {
        Row: {
          body_template: string
          created_at: string
          created_by: string | null
          default_component_id: string | null
          default_priority: string | null
          default_severity: string | null
          description: string | null
          id: string
          issue_type: string
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          body_template: string
          created_at?: string
          created_by?: string | null
          default_component_id?: string | null
          default_priority?: string | null
          default_severity?: string | null
          description?: string | null
          id?: string
          issue_type: string
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          created_by?: string | null
          default_component_id?: string | null
          default_priority?: string | null
          default_severity?: string | null
          description?: string | null
          id?: string
          issue_type?: string
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_templates_default_component_id_fkey"
            columns: ["default_component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_watchers: {
        Row: {
          created_at: string
          issue_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          issue_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          issue_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_watchers_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_watchers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          actual_behavior: string | null
          affected_version_id: string | null
          assignee_id: string | null
          closed_at: string | null
          component_id: string | null
          created_at: string
          description: string | null
          environment: string | null
          expected_behavior: string | null
          id: string
          issue_number: number
          priority: string
          project_id: string
          reporter_id: string
          resolution: string | null
          resolved_at: string | null
          severity: string
          status_id: string
          steps_to_reproduce: string | null
          target_milestone_id: string | null
          title: string
          type: string
          updated_at: string
          visibility: string
        }
        Insert: {
          actual_behavior?: string | null
          affected_version_id?: string | null
          assignee_id?: string | null
          closed_at?: string | null
          component_id?: string | null
          created_at?: string
          description?: string | null
          environment?: string | null
          expected_behavior?: string | null
          id?: string
          issue_number: number
          priority?: string
          project_id: string
          reporter_id: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status_id: string
          steps_to_reproduce?: string | null
          target_milestone_id?: string | null
          title: string
          type: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          actual_behavior?: string | null
          affected_version_id?: string | null
          assignee_id?: string | null
          closed_at?: string | null
          component_id?: string | null
          created_at?: string
          description?: string | null
          environment?: string | null
          expected_behavior?: string | null
          id?: string
          issue_number?: number
          priority?: string
          project_id?: string
          reporter_id?: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status_id?: string
          steps_to_reproduce?: string | null
          target_milestone_id?: string | null
          title?: string
          type?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_affected_version_id_fkey"
            columns: ["affected_version_id"]
            isOneToOne: false
            referencedRelation: "versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "workflow_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_target_milestone_id_fkey"
            columns: ["target_milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          project_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          project_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          name: string
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          name: string
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          name?: string
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          assignments: boolean
          comments: boolean
          mentions: boolean
          status_changes: boolean
          updated_at: string
          user_id: string
          watch_updates: boolean
        }
        Insert: {
          assignments?: boolean
          comments?: boolean
          mentions?: boolean
          status_changes?: boolean
          updated_at?: string
          user_id: string
          watch_updates?: boolean
        }
        Update: {
          assignments?: boolean
          comments?: boolean
          mentions?: boolean
          status_changes?: boolean
          updated_at?: string
          user_id?: string
          watch_updates?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          created_at: string
          data: Json | null
          id: string
          issue_id: string | null
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          issue_id?: string | null
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          issue_id?: string | null
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          joined_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          joined_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_github_repositories: {
        Row: {
          auto_resolve_enabled: boolean
          created_at: string
          created_by: string | null
          github_repository_id: string
          is_primary: boolean
          project_id: string
          target_branches: string[]
          updated_at: string
        }
        Insert: {
          auto_resolve_enabled?: boolean
          created_at?: string
          created_by?: string | null
          github_repository_id: string
          is_primary?: boolean
          project_id: string
          target_branches?: string[]
          updated_at?: string
        }
        Update: {
          auto_resolve_enabled?: boolean
          created_at?: string
          created_by?: string | null
          github_repository_id?: string
          is_primary?: boolean
          project_id?: string
          target_branches?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_github_repositories_github_repository_id_fkey"
            columns: ["github_repository_id"]
            isOneToOne: false
            referencedRelation: "github_repositories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_github_repositories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_integrations: {
        Row: {
          auto_resolve_enabled: boolean | null
          config: Json | null
          created_at: string
          id: string
          is_enabled: boolean | null
          project_id: string
          provider: string
          repo_full_name: string | null
          updated_at: string
        }
        Insert: {
          auto_resolve_enabled?: boolean | null
          config?: Json | null
          created_at?: string
          id?: string
          is_enabled?: boolean | null
          project_id: string
          provider: string
          repo_full_name?: string | null
          updated_at?: string
        }
        Update: {
          auto_resolve_enabled?: boolean | null
          config?: Json | null
          created_at?: string
          id?: string
          is_enabled?: boolean | null
          project_id?: string
          provider?: string
          repo_full_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_integrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_archived: boolean
          key: string
          name: string
          next_issue_number: number
          organization_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          is_archived?: boolean
          key: string
          name: string
          next_issue_number?: number
          organization_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          key?: string
          name?: string
          next_issue_number?: number
          organization_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          created_at: string
          created_by: string
          filters: Json
          id: string
          is_shared: boolean
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      versions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_archived: boolean
          is_released: boolean
          name: string
          project_id: string
          released_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          is_released?: boolean
          name: string
          project_id: string
          released_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          is_released?: boolean
          name?: string
          project_id?: string
          released_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_states: {
        Row: {
          category: string
          color: string | null
          created_at: string
          id: string
          is_initial: boolean
          is_terminal: boolean
          name: string
          position: number
          project_id: string
        }
        Insert: {
          category: string
          color?: string | null
          created_at?: string
          id?: string
          is_initial?: boolean
          is_terminal?: boolean
          name: string
          position: number
          project_id: string
        }
        Update: {
          category?: string
          color?: string | null
          created_at?: string
          id?: string
          is_initial?: boolean
          is_terminal?: boolean
          name?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_states_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_transitions: {
        Row: {
          created_at: string
          from_state_id: string
          id: string
          project_id: string
          required_role: string | null
          to_state_id: string
        }
        Insert: {
          created_at?: string
          from_state_id: string
          id?: string
          project_id: string
          required_role?: string | null
          to_state_id: string
        }
        Update: {
          created_at?: string
          from_state_id?: string
          id?: string
          project_id?: string
          required_role?: string | null
          to_state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_transitions_from_state_id_fkey"
            columns: ["from_state_id"]
            isOneToOne: false
            referencedRelation: "workflow_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_transitions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_transitions_to_state_id_fkey"
            columns: ["to_state_id"]
            isOneToOne: false
            referencedRelation: "workflow_states"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_attachment: {
        Args: {
          p_filename: string
          p_issue_id: string
          p_mime_type?: string
          p_size_bytes?: number
          p_storage_path: string
        }
        Returns: string
      }
      add_comment: {
        Args: { p_body: string; p_issue_id: string }
        Returns: string
      }
      add_github_link: {
        Args: {
          p_issue_id: string
          p_link_type: string
          p_number?: number
          p_repo_name: string
          p_status?: string
          p_title?: string
          p_url: string
        }
        Returns: string
      }
      add_issue_link: {
        Args: {
          p_relationship: string
          p_source_issue_id: string
          p_target_issue_id: string
        }
        Returns: string
      }
      api_add_comment: {
        Args: { p_body: string; p_issue_id: string; p_token_hash: string }
        Returns: string
      }
      api_add_github_link: {
        Args: {
          p_issue_id: string
          p_link_type: string
          p_number?: number
          p_repo_name: string
          p_status?: string
          p_title?: string
          p_token_hash: string
          p_url: string
        }
        Returns: string
      }
      api_create_issue: {
        Args: { p_payload: Json; p_token_hash: string }
        Returns: number
      }
      api_remove_github_link: {
        Args: { p_link_id: string; p_token_hash: string }
        Returns: undefined
      }
      api_update_issue: {
        Args: { p_issue_id: string; p_token_hash: string; p_updates: Json }
        Returns: undefined
      }
      assign_issue: {
        Args: { p_assignee_id?: string; p_issue_id: string }
        Returns: undefined
      }
      authenticate_api_token: {
        Args: { p_token_hash: string }
        Returns: {
          organization_id: string
          scopes: string[]
          token_id: string
          user_id: string
        }[]
      }
      bind_github_repository: {
        Args: {
          p_auto_resolve_enabled?: boolean
          p_github_repository_id: string
          p_is_primary?: boolean
          p_project_id: string
          p_target_branches?: string[]
        }
        Returns: undefined
      }
      can_comment_on_issue: { Args: { p_issue_id: string }; Returns: boolean }
      can_manage_project: { Args: { p_project_id: string }; Returns: boolean }
      can_transition_issue: {
        Args: { p_issue_id: string; p_to_state_id: string }
        Returns: boolean
      }
      can_view_issue: { Args: { p_issue_id: string }; Returns: boolean }
      claim_github_webhook_delivery: {
        Args: { p_delivery_id: string; p_lease_seconds?: number }
        Returns: boolean
      }
      cleanup_github_webhook_payloads: { Args: never; Returns: number }
      create_api_token: {
        Args: {
          p_expires_at?: string
          p_name: string
          p_organization_id: string
          p_scopes?: string[]
          p_token_hash: string
        }
        Returns: string
      }
      create_component: {
        Args: {
          p_default_assignee_id?: string
          p_description?: string
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_custom_field: {
        Args: {
          p_config?: Json
          p_field_type: string
          p_is_required?: boolean
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_issue: {
        Args: {
          p_actual_behavior?: string
          p_assignee_id?: string
          p_component_id?: string
          p_description?: string
          p_environment?: string
          p_expected_behavior?: string
          p_priority?: string
          p_project_id: string
          p_severity?: string
          p_steps_to_reproduce?: string
          p_title: string
          p_type: string
        }
        Returns: number
      }
      create_issue_template: {
        Args: {
          p_body_template?: string
          p_default_component_id?: string
          p_default_priority?: string
          p_default_severity?: string
          p_description?: string
          p_issue_type?: string
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_label: {
        Args: {
          p_color?: string
          p_description?: string
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_milestone: {
        Args: {
          p_description?: string
          p_due_at?: string
          p_name: string
          p_project_id: string
          p_status?: string
        }
        Returns: string
      }
      create_organization: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      create_project: {
        Args: {
          p_description?: string
          p_key: string
          p_name: string
          p_organization_id: string
        }
        Returns: string
      }
      create_saved_view: {
        Args: {
          p_filters?: Json
          p_is_shared?: boolean
          p_name: string
          p_project_id: string
        }
        Returns: string
      }
      create_version: {
        Args: {
          p_description?: string
          p_is_released?: boolean
          p_name: string
          p_project_id: string
          p_released_at?: string
        }
        Returns: string
      }
      delete_attachment: {
        Args: { p_attachment_id: string }
        Returns: undefined
      }
      delete_custom_field: { Args: { p_field_id: string }; Returns: undefined }
      delete_issue_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      delete_label: { Args: { p_label_id: string }; Returns: undefined }
      delete_saved_view: { Args: { p_view_id: string }; Returns: undefined }
      dispatch_issue_notification: {
        Args: {
          p_actor_id: string
          p_data?: Json
          p_issue_id: string
          p_recipient_id: string
          p_type: string
        }
        Returns: undefined
      }
      edit_comment: {
        Args: { p_body: string; p_comment_id: string }
        Returns: undefined
      }
      find_duplicate_candidates: {
        Args: { p_limit?: number; p_project_id: string; p_title: string }
        Returns: {
          issue_id: string
          issue_number: number
          similarity: number
          title: string
        }[]
      }
      get_unread_notifications_count: { Args: never; Returns: number }
      grant_issue_access: {
        Args: { p_issue_id: string; p_user_id: string }
        Returns: undefined
      }
      is_org_admin: { Args: { p_organization_id: string }; Returns: boolean }
      is_org_member: { Args: { p_organization_id: string }; Returns: boolean }
      is_project_member: { Args: { p_project_id: string }; Returns: boolean }
      is_service_role_request: { Args: never; Returns: boolean }
      link_github_artifact: {
        Args: {
          p_github_artifact_id: string
          p_issue_id: string
          p_relationship?: string
          p_source?: string
        }
        Returns: string
      }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_github_webhook_delivery: {
        Args: {
          p_delivery_id: string
          p_error?: string
          p_retry_at?: string
          p_status: string
        }
        Returns: undefined
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      project_role: { Args: { p_project_id: string }; Returns: string }
      reconcile_auto_github_links: {
        Args: {
          p_desired_links?: Json
          p_github_artifact_id: string
          p_project_id: string
        }
        Returns: number
      }
      record_github_webhook: {
        Args: {
          p_issue_id: string
          p_link_type: string
          p_number?: number
          p_project_id: string
          p_repo_name: string
          p_status?: string
          p_title?: string
          p_url: string
        }
        Returns: string
      }
      record_github_webhook_delivery: {
        Args: {
          p_action?: string
          p_delivery_id: string
          p_event_name: string
          p_github_installation_id?: number
          p_github_repository_id?: number
          p_payload?: Json
        }
        Returns: string
      }
      remove_github_integration: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      remove_github_link: { Args: { p_link_id: string }; Returns: undefined }
      remove_issue_link: { Args: { p_link_id: string }; Returns: undefined }
      reopen_issue: {
        Args: { p_comment?: string; p_issue_id: string }
        Returns: undefined
      }
      resolve_issue_from_github:
        | {
            Args: {
              p_github_repository_id: string
              p_issue_id: string
              p_project_id: string
              p_target_branch: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_issue_id: string
              p_project_id: string
              p_repo_name: string
            }
            Returns: boolean
          }
      revoke_api_token: { Args: { p_token_id: string }; Returns: undefined }
      revoke_issue_access: {
        Args: { p_issue_id: string; p_user_id: string }
        Returns: undefined
      }
      set_github_installation_status: {
        Args: { p_github_installation_id: number; p_status: string }
        Returns: undefined
      }
      set_github_primary_repository: {
        Args: { p_github_repository_id: string; p_project_id: string }
        Returns: undefined
      }
      set_github_repository_access: {
        Args: {
          p_archived?: boolean
          p_github_repository_id: number
          p_is_accessible: boolean
        }
        Returns: undefined
      }
      set_issue_custom_value: {
        Args: { p_custom_field_id: string; p_issue_id: string; p_value: Json }
        Returns: undefined
      }
      set_issue_labels: {
        Args: { p_issue_id: string; p_label_ids: string[] }
        Returns: undefined
      }
      set_issue_visibility: {
        Args: { p_issue_id: string; p_visibility: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      toggle_watch_issue: { Args: { p_issue_id: string }; Returns: boolean }
      touch_api_token: { Args: { p_token_hash: string }; Returns: undefined }
      transition_issue: {
        Args: {
          p_issue_id: string
          p_resolution?: string
          p_to_state_id: string
        }
        Returns: undefined
      }
      unbind_github_repository: {
        Args: { p_github_repository_id: string; p_project_id: string }
        Returns: undefined
      }
      unwatch_issue: { Args: { p_issue_id: string }; Returns: undefined }
      update_component: {
        Args: {
          p_component_id: string
          p_default_assignee_id?: string
          p_description?: string
          p_is_archived?: boolean
          p_name: string
        }
        Returns: undefined
      }
      update_issue_fields: {
        Args: { p_issue_id: string; p_updates: Json }
        Returns: undefined
      }
      update_issue_planning: {
        Args: {
          p_affected_version_id?: string
          p_issue_id: string
          p_target_milestone_id?: string
        }
        Returns: undefined
      }
      update_issue_template: {
        Args: {
          p_body_template?: string
          p_default_component_id?: string
          p_default_priority?: string
          p_default_severity?: string
          p_description?: string
          p_issue_type?: string
          p_name: string
          p_template_id: string
        }
        Returns: undefined
      }
      update_label: {
        Args: {
          p_color?: string
          p_description?: string
          p_label_id: string
          p_name: string
        }
        Returns: undefined
      }
      update_milestone: {
        Args: {
          p_description?: string
          p_due_at?: string
          p_milestone_id: string
          p_name: string
          p_status?: string
        }
        Returns: undefined
      }
      update_saved_view_sharing: {
        Args: { p_is_shared: boolean; p_view_id: string }
        Returns: undefined
      }
      update_version: {
        Args: {
          p_description?: string
          p_is_archived?: boolean
          p_is_released?: boolean
          p_name: string
          p_released_at?: string
          p_version_id: string
        }
        Returns: undefined
      }
      upsert_github_artifact: {
        Args: {
          p_artifact_type: string
          p_author_login?: string
          p_base_branch?: string
          p_closed_at?: string
          p_draft?: boolean
          p_external_key: string
          p_github_created_at?: string
          p_github_id?: number
          p_github_node_id?: string
          p_github_repository_id: string
          p_github_updated_at?: string
          p_head_branch?: string
          p_head_sha?: string
          p_html_url?: string
          p_merge_commit_sha?: string
          p_merged?: boolean
          p_merged_at?: string
          p_number?: number
          p_sha?: string
          p_state?: string
          p_title?: string
        }
        Returns: string
      }
      upsert_github_installation: {
        Args: {
          p_github_account_id: number
          p_github_account_login: string
          p_github_account_type?: string
          p_github_installation_id: number
          p_installed_by?: string
          p_organization_id: string
          p_permissions?: Json
          p_repository_selection?: string
          p_status?: string
        }
        Returns: string
      }
      upsert_github_integration: {
        Args: {
          p_auto_resolve_enabled?: boolean
          p_project_id: string
          p_repo_full_name: string
        }
        Returns: string
      }
      upsert_github_pr_check_summary: {
        Args: {
          p_checks?: Json
          p_completed_count: number
          p_error?: string
          p_failed_count: number
          p_github_artifact_id: string
          p_pending_count: number
          p_state: string
          p_successful_count: number
          p_total_count: number
        }
        Returns: undefined
      }
      upsert_github_repository: {
        Args: {
          p_archived?: boolean
          p_default_branch?: string
          p_full_name: string
          p_github_repository_id: number
          p_html_url?: string
          p_installation_id: string
          p_is_accessible?: boolean
          p_name: string
          p_owner_login: string
          p_private?: boolean
        }
        Returns: string
      }
      watch_issue: { Args: { p_issue_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
