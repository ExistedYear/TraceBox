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
            foreignKeyName: "notifications_issue_id_fkey";
            columns: ["issue_id"];
            isOneToOne: false;
            referencedRelation: "issues";
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
      transition_issue: {
        Args: { p_issue_id: string; p_resolution?: string; p_to_state_id: string };
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
