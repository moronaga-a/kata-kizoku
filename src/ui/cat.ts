import type { CatRefusalReason } from "../domain/types";

/**
 * 猫のリアクション。
 *
 * catRefusal() が返すのは理由のコード（"negima" など）で、セリフは持っていない。
 * 日本語の文面をここに置いているのは、文言を変えるために domain を触らなくて
 * 済むようにするため。ドメインは「何がダメか」、UI は「どう伝えるか」を持つ。
 *
 * Record<CatRefusalReason, string> にしてあるので、理由を増やすと
 * ここの書き忘れがコンパイルエラーになる。
 */
const REFUSAL_WORDS: Record<CatRefusalReason, string> = {
  negima: "ねぎはダメにゃ",
  seasoned: "しょっぱいにゃ",
  "not-ready": "まだ食べられんにゃ",
};

type Mood = "happy" | "angry";

class Cat {
  private timer = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly bubble: HTMLElement,
  ) {}

  /** 受け取ってもらえたとき */
  accept(): void {
    this.react("happy", "にゃ〜ん");
  }

  /** 断られたとき。理由に応じてセリフを変える */
  refuse(reason: CatRefusalReason): void {
    this.react("angry", REFUSAL_WORDS[reason]);
  }

  private react(mood: Mood, text: string): void {
    this.bubble.textContent = text;
    this.el.classList.remove("happy", "angry");
    // クラスを付け直してもアニメーションが再生されないので、
    // 一度レイアウトを強制的に読んでリフローを起こす。
    void this.el.offsetWidth;
    this.el.classList.add(mood);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.classList.remove("happy", "angry");
    }, 1800);
  }
}

export { Cat };
