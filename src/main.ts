// フェーズ 0 の足場。起動とゲームループはフェーズ 4〜6 で作り込む。
const app = document.querySelector<HTMLDivElement>("#app");
if (app === null) {
  throw new Error("#app が見つかりません");
}
app.textContent = "型貴族 準備中";
