import { describe, it, expect } from "vitest";
import { createOrder, remainingSeconds } from "../src/domain/orders";

describe("remainingSeconds", () => {
  it("開始直後は 60 秒残っている", () => {
    expect(remainingSeconds(createOrder("momo", "salt", 0), 0)).toBe(60);
  });

  it("経過 30000 ミリ秒で 30 秒残っている", () => {
    expect(remainingSeconds(createOrder("momo", "salt", 0), 30000)).toBe(30);
  });

  it("経過 60000 ミリ秒で 0 秒残っている", () => {
    expect(remainingSeconds(createOrder("momo", "salt", 0), 60000)).toBe(0);
  });

  it("経過 70000 ミリ秒で 0 秒残っている（クランプ）", () => {
    expect(remainingSeconds(createOrder("momo", "salt", 0), 70000)).toBe(0);
  });
});