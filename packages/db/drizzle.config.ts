import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://siftloom:siftloom_local_only@localhost:5432/siftloom"
  },
  migrations: {
    prefix: "index"
  },
  strict: true,
  verbose: true
});
