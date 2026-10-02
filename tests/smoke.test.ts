import { describe, expect, it } from "vitest";

// フェーズ 0 の動作確認用。フェーズ 3 で domain のテストを書いたら削除してよい。
describe("ツールチェーン", () => {
  it("Vitest が TypeScript のテストを実行できる", () => {
    const answer: number = 1 + 1;
    expect(answer).toBe(2);
  });
});
