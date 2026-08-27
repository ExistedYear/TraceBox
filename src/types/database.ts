// Generated shape for the current migrations. Refresh with `npm run db:types` after schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      components: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          default_assignee_id: string | null;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          default_assignee_id?: string | null;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          description?: string | null;
          default_assignee_id?: string | null;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "components_default_assignee_id_fkey";
            columns: ["default_assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "components_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      issue_events: {
        Row: {
          id: string;
          issue_id: string;
          actor_id: string | null;
          event_type: string;
          field_name: string | null;
          old_value: Json | null;
          new_value: Json | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          issue_id: string;
          actor_id?: string | null;
          event_type: string;
          field_name?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          issue_id?: string;
          actor_id?: string | null;
          event_type?: string;
          field_name?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "issue_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issue_events_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      issues: {
        Row: {
          id: string;
          project_id: string;
          issue_number: number;
          title: string;
          description: string | null;
          type: string;
          status_id: string;
          resolution: string | null;
          priority: string;
          severity: string;
          reporter_id: string;
          assignee_id: string | null;
          component_id: string | null;
          affected_version_id: string | null;
          target_milestone_id: string | null;
          environment: string | null;
          steps_to_reproduce: string | null;
          expected_behavior: string | null;
          actual_behavior: string | null;
          visibility: string;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          issue_number: number;
          title: string;
          description?: string | null;
          type: string;
          status_id: string;
          resolution?: string | null;
          priority?: string;
          severity?: string;
          reporter_id: string;
          assignee_id?: string | null;
          component_id?: string | null;
          affected_version_id?: string | null;
          target_milestone_id?: string | null;
          environment?: string | null;
          steps_to_reproduce?: string | null;
          expected_behavior?: string | null;
          actual_behavior?: string | null;
          visibility?: string;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          issue_number?: number;
          title?: string;
          description?: string | null;
          type?: string;
          status_id?: string;
          resolution?: string | null;
          priority?: string;
          severity?: string;
          reporter_id?: string;
          assignee_id?: string | null;
          component_id?: string | null;
          affected_version_id?: string | null;
          target_milestone_id?: string | null;
          environment?: string | null;
          steps_to_reproduce?: string | null;
          expected_behavior?: string | null;
          actual_behavior?: string | null;
          visibility?: string;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
          closed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "issues_affected_version_id_fkey";
            columns: ["affected_version_id"];
            isOneToOne: false;
            referencedRelation: "versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_component_id_fkey";
            columns: ["component_id"];
            isOneToOne: false;
            referencedRelation: "components";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_status_id_fkey";
            columns: ["status_id"];
            isOneToOne: false;
            referencedRelation: "workflow_states";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issues_target_milestone_id_fkey";
            columns: ["target_milestone_id"];
            isOneToOne: false;
            referencedRelation: "milestones";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          organization_id: string;
          user_id: string;
          role: string;
          joined_at: string;
        };
        Insert: {
          organization_id: string;
          user_id: string;
          role?: string;
          joined_at?: string;
        };
        Update: {
          organization_id?: string;
          user_id?: string;
          role?: string;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          owner_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          owner_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          project_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          project_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          project_id?: string;
          user_id?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          key: string;
          slug: string;
          description: string | null;
          next_issue_number: number;
          is_archived: boolean;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          key: string;
          slug: string;
          description?: string | null;
          next_issue_number?: number;
          is_archived?: boolean;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          key?: string;
          slug?: string;
          description?: string | null;
          next_issue_number?: number;
          is_archived?: boolean;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      workflow_states: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          category: string;
          position: number;
          color: string | null;
          is_initial: boolean;
          is_terminal: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          category: string;
          position: number;
          color?: string | null;
          is_initial?: boolean;
          is_terminal?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          category?: string;
          position?: number;
          color?: string | null;
          is_initial?: boolean;
          is_terminal?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workflow_states_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      comments: {
        Row: {
          id: string;
          issue_id: string;
          author_id: string;
          body: string;
          edited_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          issue_id: string;
          author_id: string;
          body: string;
          edited_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          issue_id?: string;
          author_id?: string;
          body?: string;
          edited_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      workflow_transitions: {
        Row: {
          id: string;
          project_id: string;
          from_state_id: string;
          to_state_id: string;
          required_role: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          from_state_id: string;
          to_state_id: string;
          required_role?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          from_state_id?: string;
          to_state_id?: string;
          required_role?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workflow_transitions_from_state_id_fkey";
            columns: ["from_state_id"];
            isOneToOne: false;
            referencedRelation: "workflow_states";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workflow_transitions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workflow_transitions_to_state_id_fkey";
            columns: ["to_state_id"];
            isOneToOne: false;
            referencedRelation: "workflow_states";
            referencedColumns: ["id"];
          },
        ];
      };
      labels: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          color?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          description?: string | null;
          color?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "labels_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      issue_labels: {
        Row: {
          issue_id: string;
          label_id: string;
        };
        Insert: {
          issue_id: string;
          label_id: string;
        };
        Update: {
          issue_id?: string;
          label_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "issue_labels_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issue_labels_label_id_fkey";
            columns: ["label_id"];
            isOneToOne: false;
            referencedRelation: "labels";
            referencedColumns: ["id"];
          },
        ];
      };
      versions: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          released_at: string | null;
          is_released: boolean;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          released_at?: string | null;
          is_released?: boolean;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          description?: string | null;
          released_at?: string | null;
          is_released?: boolean;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "versions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      milestones: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          due_at: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          due_at?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          description?: string | null;
          due_at?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      issue_watchers: {
        Row: {
          issue_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          issue_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          issue_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "issue_watchers_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          actor_id: string | null;
          issue_id: string | null;
          type: string;
          data: Json | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          actor_id?: string | null;
          issue_id?: string | null;
          type: string;
          data?: Json | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          actor_id?: string | null;
          issue_id?: string | null;
          type?: string;
          data?: Json | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          user_id: string;
          mentions: boolean;
          assignments: boolean;
          comments: boolean;
          status_changes: boolean;
          watch_updates: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          mentions?: boolean;
          assignments?: boolean;
          comments?: boolean;
          status_changes?: boolean;
          watch_updates?: boolean;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          mentions?: boolean;
          assignments?: boolean;
          comments?: boolean;
          status_changes?: boolean;
          watch_updates?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      saved_views: {
        Row: {
          id: string;
          project_id: string;
          created_by: string;
          name: string;
          filters: Json;
          is_shared: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          created_by: string;
          name: string;
          filters?: Json;
          is_shared?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          created_by?: string;
          name?: string;
          filters?: Json;
          is_shared?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_views_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      issue_links: {
        Row: {
          id: string;
          source_issue_id: string;
          target_issue_id: string;
          relationship: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          source_issue_id: string;
          target_issue_id: string;
          relationship: string;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          source_issue_id?: string;
          target_issue_id?: string;
          relationship?: string;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "issue_links_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issue_links_source_issue_id_fkey";
            columns: ["source_issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "issue_links_target_issue_id_fkey";
            columns: ["target_issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          id: string;
          issue_id: string;
          uploader_id: string;
          filename: string;
          storage_path: string;
          mime_type: string | null;
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          issue_id: string;
          uploader_id: string;
          filename: string;
          storage_path: string;
          mime_type?: string | null;
          size_bytes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          issue_id?: string;
          uploader_id?: string;
          filename?: string;
          storage_path?: string;
          mime_type?: string | null;
          size_bytes?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
            referencedColumns: ["id"];
          },
        ];
      };
      issue_templates: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          description: string | null;
          issue_type: string;
          body_template: string;
          default_priority: string | null;
          default_severity: string | null;
          default_component_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          description?: string | null;
          issue_type?: string;
          body_template: string;
          default_priority?: string | null;
          default_severity?: string | null;
          default_component_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          description?: string | null;
          issue_type?: string;
          body_template?: string;
          default_priority?: string | null;
          default_severity?: string | null;
          default_component_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      issue_access: {
        Row: {
          issue_id: string;
          user_id: string;
          granted_by: string | null;
          created_at: string;
        };
        Insert: {
          issue_id: string;
          user_id: string;
          granted_by?: string | null;
          created_at?: string;
        };
        Update: {
          issue_id?: string;
          user_id?: string;
          granted_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      issue_github_links: {
        Row: {
          id: string;
          issue_id: string;
          repo_name: string;
          link_type: string;
          number: number | null;
          url: string;
          title: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          issue_id: string;
          repo_name: string;
          link_type: string;
          number?: number | null;
          url: string;
          title?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          issue_id?: string;
          repo_name?: string;
          link_type?: string;
          number?: number | null;
          url?: string;
          title?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      project_integrations: {
        Row: {
          id: string;
          project_id: string;
          provider: string;
          repo_full_name: string | null;
          auto_resolve_enabled: boolean;
          config: Json;
          is_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          provider: string;
          repo_full_name?: string | null;
          auto_resolve_enabled?: boolean;
          config?: Json;
          is_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          provider?: string;
          repo_full_name?: string | null;
          auto_resolve_enabled?: boolean;
          config?: Json;
          is_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      custom_fields: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          field_type: string;
          config: Json;
          is_required: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name: string;
          field_type: string;
          config?: Json;
          is_required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          name?: string;
          field_type?: string;
          config?: Json;
          is_required?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      issue_custom_values: {
        Row: {
          issue_id: string;
          custom_field_id: string;
          value: Json;
        };
        Insert: {
          issue_id: string;
          custom_field_id: string;
          value: Json;
        };
        Update: {
          issue_id?: string;
          custom_field_id?: string;
          value?: Json;
        };
        Relationships: [];
      };
      api_tokens: {
        Row: {
          id: string;
          user_id: string;
          organization_id: string;
          name: string;
          token_hash: string;
          scopes: string[];
          last_used_at: string | null;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          organization_id: string;
          name: string;
          token_hash: string;
          scopes?: string[];
          last_used_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          organization_id?: string;
          name?: string;
          token_hash?: string;
          scopes?: string[];
          last_used_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_comment: {
        Args: { p_body: string; p_issue_id: string };
        Returns: string;
      };
      assign_issue: {
        Args: { p_assignee_id?: string | null; p_issue_id: string };
        Returns: undefined;
      };
      can_comment_on_issue: {
        Args: { p_issue_id: string };
        Returns: boolean;
      };
      can_transition_issue: {
        Args: { p_issue_id: string; p_to_state_id: string };
        Returns: boolean;
      };
      can_manage_project: {
        Args: { p_project_id: string };
        Returns: boolean;
      };
      can_view_issue: {
        Args: { p_issue_id: string };
        Returns: boolean;
      };
      create_component: {
        Args: { p_default_assignee_id?: string; p_description?: string; p_name: string; p_project_id: string };
        Returns: string;
      };
      create_issue: {
        Args: {
          p_actual_behavior?: string;
          p_assignee_id?: string;
          p_component_id?: string;
          p_description?: string;
          p_environment?: string;
          p_expected_behavior?: string;
          p_priority?: string;
          p_project_id: string;
          p_severity?: string;
          p_steps_to_reproduce?: string;
          p_title: string;
          p_type: string;
        };
        Returns: number;
      };
      create_label: {
        Args: { p_color?: string; p_description?: string; p_name: string; p_project_id: string };
        Returns: string;
      };
      create_milestone: {
        Args: { p_description?: string; p_due_at?: string; p_name: string; p_project_id: string; p_status?: string };
        Returns: string;
      };
      create_version: {
        Args: { p_description?: string; p_is_released?: boolean; p_name: string; p_project_id: string; p_released_at?: string };
        Returns: string;
      };
      delete_label: {
        Args: { p_label_id: string };
        Returns: undefined;
      };
      set_issue_labels: {
        Args: { p_issue_id: string; p_label_ids: string[] };
        Returns: undefined;
      };
      get_unread_notifications_count: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      create_saved_view: {
        Args: { p_filters?: Json; p_is_shared?: boolean; p_name: string; p_project_id: string };
        Returns: string;
      };
      delete_saved_view: {
        Args: { p_view_id: string };
        Returns: undefined;
      };
      mark_all_notifications_read: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      mark_notification_read: {
        Args: { p_notification_id: string };
        Returns: undefined;
      };
      toggle_watch_issue: {
        Args: { p_issue_id: string };
        Returns: boolean;
      };
      unwatch_issue: {
        Args: { p_issue_id: string };
        Returns: undefined;
      };
      watch_issue: {
        Args: { p_issue_id: string };
        Returns: undefined;
      };
      update_issue_planning: {
        Args: { p_affected_version_id?: string | null; p_issue_id: string; p_target_milestone_id?: string | null };
        Returns: undefined;
      };
      update_label: {
        Args: { p_color?: string; p_description?: string; p_label_id: string; p_name: string };
        Returns: undefined;
      };
      update_milestone: {
        Args: { p_description?: string; p_due_at?: string; p_milestone_id: string; p_name: string; p_status?: string };
        Returns: undefined;
      };
      update_version: {
        Args: { p_description?: string; p_is_archived?: boolean; p_is_released?: boolean; p_name: string; p_released_at?: string; p_version_id: string };
        Returns: undefined;
      };
      edit_comment: {
        Args: { p_body: string; p_comment_id: string };
        Returns: undefined;
      };
      update_issue_fields: {
        Args: { p_issue_id: string; p_updates: Json };
        Returns: undefined;
      };
      create_organization: {
        Args: { p_name: string; p_slug: string };
        Returns: string;
      };
      update_component: {
        Args: { p_component_id: string; p_default_assignee_id?: string; p_description?: string; p_is_archived?: boolean; p_name: string };
        Returns: undefined;
      };
      create_project: {
        Args: { p_description?: string; p_key: string; p_name: string; p_organization_id: string };
        Returns: string;
      };
      is_org_admin: {
        Args: { p_organization_id: string };
        Returns: boolean;
      };
      is_org_member: {
        Args: { p_organization_id: string };
        Returns: boolean;
      };
      is_project_member: {
        Args: { p_project_id: string };
        Returns: boolean;
      };
      project_role: {
        Args: { p_project_id: string };
        Returns: string;
      };
      reopen_issue: {
        Args: { p_comment?: string; p_issue_id: string };
        Returns: undefined;
      };
      add_issue_link: {
        Args: { p_relationship: string; p_source_issue_id: string; p_target_issue_id: string };
        Returns: string;
      };
      remove_issue_link: {
        Args: { p_link_id: string };
        Returns: undefined;
      };
      find_duplicate_candidates: {
        Args: { p_limit?: number; p_project_id: string; p_title: string };
        Returns: { issue_id: string; issue_number: number; similarity: number; title: string }[];
      };
      transition_issue: {
        Args: { p_issue_id: string; p_resolution?: string; p_to_state_id: string };
        Returns: undefined;
      };
      add_attachment: {
        Args: { p_filename: string; p_issue_id: string; p_mime_type?: string; p_size_bytes?: number; p_storage_path: string };
        Returns: string;
      };
      delete_attachment: {
        Args: { p_attachment_id: string };
        Returns: undefined;
      };
      create_issue_template: {
        Args: { p_body_template?: string; p_default_component_id?: string; p_default_priority?: string; p_default_severity?: string; p_description?: string; p_issue_type?: string; p_name: string; p_project_id: string };
        Returns: string;
      };
      update_issue_template: {
        Args: { p_body_template?: string; p_default_component_id?: string; p_default_priority?: string; p_default_severity?: string; p_description?: string; p_issue_type?: string; p_name: string; p_template_id: string };
        Returns: undefined;
      };
      delete_issue_template: {
        Args: { p_template_id: string };
        Returns: undefined;
      };
      grant_issue_access: {
        Args: { p_issue_id: string; p_user_id: string };
        Returns: undefined;
      };
      revoke_issue_access: {
        Args: { p_issue_id: string; p_user_id: string };
        Returns: undefined;
      };
      set_issue_visibility: {
        Args: { p_issue_id: string; p_visibility: string };
        Returns: undefined;
      };
      add_github_link: {
        Args: { p_issue_id: string; p_link_type: string; p_number?: number; p_repo_name: string; p_status?: string; p_title?: string; p_url: string };
        Returns: string;
      };
      remove_github_link: {
        Args: { p_link_id: string };
        Returns: undefined;
      };
      create_custom_field: {
        Args: { p_config?: Json; p_field_type: string; p_is_required?: boolean; p_name: string; p_project_id: string };
        Returns: string;
      };
      delete_custom_field: {
        Args: { p_field_id: string };
        Returns: undefined;
      };
      set_issue_custom_value: {
        Args: { p_custom_field_id: string; p_issue_id: string; p_value: Json };
        Returns: undefined;
      };
      create_api_token: {
        Args: { p_expires_at?: string; p_name: string; p_organization_id: string; p_scopes?: string[]; p_token_hash: string };
        Returns: string;
      };
      revoke_api_token: {
        Args: { p_token_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
