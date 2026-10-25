import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const migration = readFileSync(new URL("./migrations/0001_initial.sql", import.meta.url), "utf8").trim();
const runtimeSchema = readFileSync(new URL("../../workers/backend-api/src/db/schema.sql", import.meta.url), "utf8").trim();
assert.equal(migration, runtimeSchema, "D1 migration and runtime schema differ; update the migration and schema together.");
console.log("D1 migration matches the Backend API schema.");
