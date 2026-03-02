import { readFileSync } from "fs";
import { join } from "path";
import { pool } from "./client";

async function runSchema() {
  const schemaPath = join(__dirname, "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  await pool.query(sql);
  console.log("Schema applied successfully");
  await pool.end();
}

runSchema().catch((err) => {
  console.error("Schema failed", err);
  process.exit(1);
});
