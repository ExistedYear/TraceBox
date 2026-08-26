import { z } from "zod";

export const savedViewSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(80, "Max 80 chars"),
  is_shared: z.boolean().default(false),
});

export type SavedViewValues = z.infer<typeof savedViewSchema>;

export type SavedViewRow = {
  id: string;
  project_id: string;
  name: string;
  filters: Record<string, string>;
  is_shared: boolean;
  created_by: string;
};

export function encodeSavedViewFilters(filters: Record<string, string>): string {
  return new URLSearchParams(filters).toString();
}

export function decodeSavedViewFilters(query: string): Record<string, string> {
  const params = new URLSearchParams(query);
  const result: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (v) result[k] = v;
  }
  return result;
}

export function matchesSearch(issue: { title: string; description: string | null; keyLabel: string }, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  return (
    issue.title.toLowerCase().includes(q) ||
    (issue.description?.toLowerCase().includes(q) ?? false) ||
    issue.keyLabel.toLowerCase().includes(q)
  );
}
