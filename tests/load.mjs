/* index.html の中の処理を、画面なしで Node から呼べるように取り出す。
   アプリは1ファイルのままにしておきたいので、テストのほうが名前で関数を抜き出して評価する。
   名前が見つからない・形が変わったときは、ここで例外になってテストが落ちる（気づかずに通らない） */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("<script>", html.indexOf("<body"));
const src = html.slice(start + 8, html.indexOf("</script>", start));

// 行頭の宣言から、括弧の対応がとれるところ（または文の終わり）までを切り出す。
// 文字列・正規表現の中の括弧も数えるが、対象の関数では対になっているので問題ない
function extract(name) {
  const m = new RegExp(`^(?:async function|function|const|let) ${name}\\b`, "m").exec(src);
  if (!m) throw new Error(`index.html に ${name} が見つかりません`);
  let i = m.index, depth = 0, opened = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") { depth++; opened = true; }
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "\n" && depth === 0 && (opened || src[i - 1] === ";")) break;
  }
  return src.slice(m.index, i);
}

const NAMES = [
  "CURRENCIES", "DAY_MS", "UNITS", "isIso", "clampFee", "isYmd", "repaired",
  "normalizeItem", "normalizeAll", "normalizePaid", "numMap", "SETTING_KEYS", "stampChanges",
  "TOMB_DAYS", "mergeData", "sortKeys", "sameData",
  "today", "ymd", "parseYmd", "addDays", "addMonths",
  "monthsOf", "monthsOcc", "applyEom", "occAt", "firstIndexFrom", "nextBilling", "occBetween",
];

// 呼び出し側から差し替えたいもの（state・applyingRemote）は var にして外から触れるようにする
export function loadApp() {
  const ctx = { tr: s => s, console };
  vm.createContext(ctx);
  const code = [
    "var state = { items: [], paid: {}, tomb: {}, paidMt: {}, paidTomb: {}, setMt: 0, rates: {}, rateFee: 0, autoRate: true, ratesAt: '', ratesDate: '', ratesSrc: '' };",
    "var applyingRemote = false;",
    ...NAMES.map(extract),
    `({ ${NAMES.filter(n => n !== "repaired").join(", ")} })`,
  ].join("\n");
  const api = vm.runInContext(code, ctx);
  api.ctx = ctx;
  return api;
}
