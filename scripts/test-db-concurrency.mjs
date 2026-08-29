import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

function required(value, name) {
  if (!value) throw new Error(`Supabase local status did not include ${name}`);
  return value;
}

function unwrap(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

let statusOutput;
try {
  statusOutput = execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  statusOutput = execFileSync("npx", ["--yes", "supabase", "status", "-o", "json"], { encoding: "utf8" });
}
const status = JSON.parse(statusOutput);
const url = required(status.API_URL, "API_URL");
const anonKey = required(status.ANON_KEY, "ANON_KEY");
const serviceRoleKey = required(status.SERVICE_ROLE_KEY, "SERVICE_ROLE_KEY");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const email = `concurrency-${suffix}@example.test`;
const password = `TraceBox-${randomUUID()}-Aa1!`;
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
let organizationId;
let userId;

try {
  const created = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create test user");
  userId = created.user.id;
  unwrap(await browser.auth.signInWithPassword({ email, password }), "sign in test user");
  organizationId = unwrap(await browser.rpc("create_organization", { p_name: `Concurrency ${suffix}`, p_slug: `concurrency-${suffix}` }), "create test workspace");
  const projectId = unwrap(await browser.rpc("create_project", {
    p_description: "Disposable allocator concurrency verification",
    p_key: `C${suffix.slice(0, 5).toUpperCase()}`,
    p_name: `Concurrency ${suffix}`,
    p_organization_id: organizationId,
  }), "create test project");

  const attempts = 12;
  const results = await Promise.all(Array.from({ length: attempts }, (_, index) =>
    browser.rpc("create_issue_complete", {
      p_payload: { title: `Concurrent issue ${index + 1}`, description: "Created by the real concurrency verification script." },
      p_project_id: projectId,
    }).then((result) => unwrap(result, `create concurrent issue ${index + 1}`))
  ));
  const numbers = results.map(Number).sort((left, right) => left - right);
  const expected = Array.from({ length: attempts }, (_, index) => index + 1);
  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    throw new Error(`Issue allocator returned ${JSON.stringify(numbers)}; expected ${JSON.stringify(expected)}`);
  }
  process.stdout.write(`Concurrent allocator verified ${attempts} unique sequential issue numbers.\n`);
} finally {
  try {
    if (organizationId) await admin.from("organizations").delete().eq("id", organizationId);
  } finally {
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
}
