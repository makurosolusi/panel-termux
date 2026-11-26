import { defineConfig } from "drizzle-kit";

// driver "durable-sqlite" makes drizzle-kit also emit drizzle/migrations.js, which statically imports
// every .sql file so `bun build --compile` embeds them (no drizzle/ folder next to the binary).
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
});
