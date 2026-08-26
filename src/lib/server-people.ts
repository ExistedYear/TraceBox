import { createClient } from "@/lib/supabase/server";

// Resolves profile display names for auth-user ids (assignees/reporters/actors).
export async function displayNameMap(userIds: (string | null | undefined)[]) {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map<string, string>();

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", unique);
  return new Map((data ?? []).map((row) => [row.id, row.display_name ?? ""]));
}
