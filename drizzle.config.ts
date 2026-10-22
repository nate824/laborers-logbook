import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // `session` is owned by connect-pg-simple, not shared/schema.ts. Without this
  // filter `drizzle-kit push` drops it and logs every user out.
  tablesFilter: ["!session"],
});
