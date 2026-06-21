import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(__dirname).replace(/\\/g, "/");

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: [
      // Neutralize the "server-only" guard so server modules import under test.
      { find: "server-only", replacement: `${root}/tests/stubs/empty.ts` },
      // Mirror the tsconfig "@/*" -> "./*" path mapping.
      { find: /^@\//, replacement: `${root}/` }
    ]
  }
});
