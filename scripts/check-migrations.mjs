import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const migrationsDir = fileURLToPath(new URL("supabase/migrations/", root));
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const expected = Array.from({ length: files.length }, (_, index) => String(index + 1).padStart(4, "0"));
const actual = files.map((file) => file.match(/^20260826(\d{4})_/)?.[1]);
if (actual.some((value, index) => value !== expected[index])) {
  throw new Error(`Migrations must be contiguous from 0001: ${actual.join(", ")}`);
}
const consolidated = await readFile(new URL("supabase/full_schema.sql", root), "utf8");
const source = (await Promise.all(files.map((file) => readFile(join(fileURLToPath(new URL("supabase/migrations/", root)), file), "utf8")))).join("");
if (consolidated !== source) throw new Error("supabase/full_schema.sql is stale; regenerate it from supabase/migrations/*.sql");
console.log(`Migration chain valid: ${files.length} files`);
