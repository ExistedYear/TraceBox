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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
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
