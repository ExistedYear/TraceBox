import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { accountDisplayNameSchema, accountEmailSchema, accountPasswordSchema } from "../src/lib/validation/account";

const migration = readFileSync(new URL("../supabase/migrations/202608260063_account_management.sql", import.meta.url), "utf8");
const component = readFileSync(new URL("../src/components/account/account-management.tsx", import.meta.url), "utf8");

describe("personal account management", () => {
  it("validates profile and auth fields", () => {
    expect(accountDisplayNameSchema.parse({ displayName: "Ada Lovelace" }).displayName).toBe("Ada Lovelace");
    expect(accountEmailSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(accountPasswordSchema.safeParse({ password: "correct-horse", confirmPassword: "different" }).success).toBe(false);
  });

  it("keeps avatar storage owner-scoped and MIME/size limited", () => {
    expect(migration).toContain("Migration 063");
    expect(migration).toContain("profile-avatars");
    expect(migration).toContain("file_size_limit = 5242880");
    expect(migration).toContain("allowed_mime_types");
    expect(migration).toContain("(select auth.uid()::text)");
    expect(migration).toContain("metadata->>'mimetype'");
    expect(migration).toContain("update_current_profile(text, text)");
    expect(migration).toContain("drop policy if exists \"Users can update their own profile\"");
    expect(migration).toContain("supabase\\.co");
    expect(migration).toContain("select 1 from storage.objects");

    const userId = "123e4567-e89b-12d3-a456-426614174000";
    const objectPath = `${userId}/987e6543-e21b-43d3-a654-426614174111.png`;
    const publicUrl = `https://project.supabase.co/storage/v1/object/public/profile-avatars/${objectPath}`;
    expect(objectPath).toMatch(new RegExp(`^${userId}/[0-9a-f-]{36}\\.(png|jpe?g|webp|gif)$`));
    expect(publicUrl).toMatch(new RegExp(`/storage/v1/object/public/profile-avatars/${userId}/[0-9a-f-]{36}\\.png$`));
  });

  it("uses unique UUID/avatar extension paths and Auth for sensitive changes", () => {
    expect(component).toContain("crypto.randomUUID()");
    expect(component).toContain("storage.from(AVATAR_BUCKET).upload");
    expect(component).toContain("storage.from(AVATAR_BUCKET).remove");
    expect(component).toContain("auth.updateUser({ email");
    expect(component).toContain("auth.updateUser({ password");
    expect(component).toContain("scope: \"global\"");
    expect(component).toContain("/forgot-password");
  });
});
