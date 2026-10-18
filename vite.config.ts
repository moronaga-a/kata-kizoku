import { defineConfig } from "vitest/config";

/**
 * GitHub Pages はリポジトリ名のサブパス（/kata-kizoku/）で配信されるので、
 * ビルド時だけ base を変える。開発サーバーは / のままにしておく。
 *
 * リポジトリ名を変えたら、ここも合わせること。
 * ユーザーサイト（<user>.github.io）や独自ドメインで配信する場合は "/" でよい。
 */
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/kata-kizoku/" : "/",
  test: {
    // domain / game は純粋なロジックなので DOM は要らない
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
}));
