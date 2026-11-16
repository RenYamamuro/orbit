/* 請求日の計算のテスト。月末・うるう年・指定月払いなど、ずれやすい所を確かめる */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load.mjs";

const { normalizeItem, nextBilling, occBetween, parseYmd, ymd } = loadApp();
const it = o => normalizeItem({ id: "t", name: "t", amount: 1000, every: 1, unit: "month", ...o });
const next = (o, from) => ymd(nextBilling(it(o), parseYmd(from)));
const between = (o, a, b) => Array.from(occBetween(it(o), parseYmd(a), parseYmd(b)), ymd);

test("毎月：31日始まりは、短い月は月末になり、翌月は31日に戻る", () => {
  assert.deepEqual(between({ firstDate: "2026-01-31" }, "2026-01-01", "2026-04-30"),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("毎月末払い：うるう年の2月は29日", () => {
  assert.equal(next({ firstDate: "2027-12-31", eom: true }, "2028-02-01"), "2028-02-29");
});

test("毎年：2/29 始まりは、うるう年でない年は 2/28", () => {
  assert.equal(next({ firstDate: "2024-02-29", unit: "year" }, "2025-01-01"), "2025-02-28");
  assert.equal(next({ firstDate: "2024-02-29", unit: "year" }, "2028-01-01"), "2028-02-29");
});

test("当日が請求日なら、次の請求は当日", () => {
  assert.equal(next({ firstDate: "2026-01-10" }, "2026-03-10"), "2026-03-10");
  assert.equal(next({ firstDate: "2026-01-10" }, "2026-03-11"), "2026-04-10");
});

test("2ヶ月ごと・毎週・30日ごと", () => {
  assert.deepEqual(between({ firstDate: "2026-01-15", every: 2 }, "2026-01-01", "2026-06-30"), ["2026-01-15", "2026-03-15", "2026-05-15"]);
  assert.equal(next({ firstDate: "2026-01-01", unit: "week" }, "2026-01-09"), "2026-01-15");
  assert.equal(next({ firstDate: "2026-01-01", unit: "day", every: 30 }, "2026-02-01"), "2026-03-02");
});

test("指定月払い（住民税の6・8・10・1月）は年をまたいで続く", () => {
  assert.deepEqual(between({ firstDate: "2026-06-30", unit: "months", months: [6, 8, 10, 1] }, "2026-06-01", "2027-07-31"),
    ["2026-06-30", "2026-08-30", "2026-10-30", "2027-01-30", "2027-06-30"]);
});

test("初回より前の日から数えると、初回が次の請求", () => {
  assert.equal(next({ firstDate: "2027-05-20", unit: "year" }, "2026-01-01"), "2027-05-20");
});
