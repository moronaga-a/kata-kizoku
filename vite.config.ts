import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // domain / game は純粋なロジックなので DOM は要らない
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
