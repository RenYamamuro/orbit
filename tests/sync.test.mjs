/* 端末間の同期（項目ごとの合わせ込み）のテスト。
   データが消えるかどうかに直結するので、思いつく食い違いの場面をここに並べておく。
   実行: node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load.mjs";

const app = loadApp();
const { mergeData, sameData, stampChanges, normalizeItem } = app;

const T0 = Date.now() - 60_000;            // 少し前の時刻（削除の記録の期限切れに掛からないように）
const item = (id, mt, extra = {}) => normalizeItem({
  id, name: id, amount: 1000, currency: "JPY", unit: "month", every: 1,
  firstDate: "2026-01-05", createdAt: "2026-01-01", mt, ...extra,
});
const data = (items, extra = {}) => ({
  items, paid: {}, tomb: {}, paidMt: {}, paidTomb: {}, setMt: 0,
  rates: { JPY: 1, USD: 150 }, rateFee: 0, autoRate: true, ratesAt: "", ratesDate: "", ratesSrc: "", ...extra,
});
// 取り出した処理は別の実行環境で動くので、比べる前に普通の値に直す
const plain = x => JSON.parse(JSON.stringify(x));
const ids = d => plain(d.items.map(i => i.id)).sort();

// 1台の端末を、save() と同じ順序（前の内容と比べて記録をつける）で動かす
function device(initial) {
  let saved = JSON.stringify(initial);
  return {
    get state() { return JSON.parse(saved); },
    edit(fn) {
      const st = JSON.parse(saved);
      fn(st);
      app.ctx.state = st;
      stampChanges(saved);
      saved = JSON.stringify(st);
    },
    adopt(d) { saved = JSON.stringify(d); },
  };
}

test("片方だけにある項目は両方とも残る", () => {
  const m = mergeData(data([item("a", T0)]), data([item("b", T0)]));
  assert.deepEqual(ids(m), ["a", "b"]);
});

test("同じ項目は、後から変更したほうが残る（どちらから合わせても同じ）", () => {
  const a = data([item("x", T0, { amount: 500 })]);
  const b = data([item("x", T0 + 1000, { amount: 800 })]);
  assert.equal(mergeData(a, b).items[0].amount, 800);
  assert.equal(mergeData(b, a).items[0].amount, 800);
  assert.ok(sameData(mergeData(a, b), mergeData(b, a)));
});

test("削除した項目は、相手が古い内容を持っていても復活しない", () => {
  const a = data([], { tomb: { x: T0 + 1000 } });
  const b = data([item("x", T0)]);
  assert.deepEqual(ids(mergeData(a, b)), []);
  assert.deepEqual(ids(mergeData(b, a)), []);
});

test("削除より後に相手が編集していたら、編集が勝って残る", () => {
  const a = data([], { tomb: { x: T0 } });
  const b = data([item("x", T0 + 1000, { amount: 2000 })]);
  const m = mergeData(a, b);
  assert.deepEqual(ids(m), ["x"]);
  assert.equal(m.tomb.x, undefined, "残した項目の削除の記録は消す");
});

test("支払いの記録：取り消しと記録は新しいほうが勝つ", () => {
  const k = "x@2026-02-05";
  const paidA = data([item("x", T0)], { paid: { [k]: { amt: 1000, at: "2026-02-05" } }, paidMt: { [k]: T0 } });
  const undoneB = data([item("x", T0)], { paidTomb: { [k]: T0 + 1000 } });
  assert.equal(mergeData(paidA, undoneB).paid[k], undefined);
  const repaidA = data([item("x", T0)], { paid: { [k]: { amt: 1200, at: "2026-02-06" } }, paidMt: { [k]: T0 + 2000 } });
  assert.equal(mergeData(repaidA, undoneB).paid[k].amt, 1200);
});

test("為替などの設定は、後から変えたほうがまとめて残る", () => {
  const a = data([], { rates: { JPY: 1, USD: 140 }, rateFee: 2, setMt: T0 });
  const b = data([], { rates: { JPY: 1, USD: 160 }, rateFee: 0, setMt: T0 + 1 });
  const m = mergeData(a, b);
  assert.equal(m.rates.USD, 160);
  assert.equal(m.rateFee, 0);
});

test("何度合わせても結果が変わらない（同じ内容を送り合って止まらなくならない）", () => {
  const a = data([item("a", T0), item("x", T0 + 5)], { tomb: { z: T0 } });
  const b = data([item("b", T0), item("x", T0 + 9, { amount: 3 })]);
  const once = mergeData(a, b);
  assert.ok(sameData(mergeData(once, b), once));
  assert.ok(sameData(mergeData(once, once), once));
});

test("古い版のデータ（変更時刻なし）とも合わせられる", () => {
  const legacy = { items: [{ id: "old", name: "古い項目", amount: 500, unit: "month", every: 1, firstDate: "2024-03-01" }] };
  const m = mergeData(legacy, data([item("new", T0)]));
  assert.deepEqual(ids(m), ["new", "old"]);
});

test("壊れたデータが混ざっていても落ちない", () => {
  const bad = { items: [null, { name: "idなし" }, { id: "ok", amount: "abc", every: 0, unit: "??" }], tomb: { q: "x" }, paid: { "bad-key": 1 } };
  const m = mergeData(bad, data([]));
  assert.deepEqual(ids(m), ["ok"]);
  assert.equal(m.items[0].amount, 0);
  assert.equal(m.items[0].every, 1);
  assert.deepEqual(plain(m.paid), {});
});

test("並び順が違うだけなら同じ内容とみなす", () => {
  const a = data([item("a", T0), item("b", T0)]);
  const b = data([item("b", T0), item("a", T0)]);
  assert.ok(sameData(a, b));
  assert.ok(!sameData(a, data([item("a", T0)])));
});

test("2台で電波のないまま別々に変更しても、両方の変更が残る", () => {
  const base = data([item("a", T0), item("b", T0), item("c", T0)]);
  const phone = device(base), mac = device(base);

  phone.edit(st => { st.items.find(i => i.id === "a").amount = 1500; });              // 値上げ
  phone.edit(st => { st.items.push(item("d", 0)); });                                    // 追加
  mac.edit(st => { st.items = st.items.filter(i => i.id !== "b"); });                   // 削除
  mac.edit(st => { st.items.find(i => i.id === "c").memo = "家族プラン"; });             // メモ

  const cloud = mergeData(phone.state, mac.state);
  assert.deepEqual(ids(cloud), ["a", "c", "d"]);
  assert.equal(cloud.items.find(i => i.id === "a").amount, 1500);
  assert.equal(cloud.items.find(i => i.id === "c").memo, "家族プラン");
  assert.ok(sameData(mergeData(mac.state, phone.state), cloud), "どちらから合わせても同じ");
});

test("同期の取り込みでは変更時刻をつけ直さない（取り込んだだけで新しい変更に見えない）", () => {
  const dev = device(data([item("a", T0)]));
  app.ctx.applyingRemote = true;
  try { dev.edit(st => { st.items[0].amount = 9; }); } finally { app.ctx.applyingRemote = false; }
  assert.equal(dev.state.items[0].mt, T0);
});

test("ずっと前の削除の記録は片付ける（記録が増え続けない）", () => {
  const old = Date.now() - 200 * 86400000;
  const m = mergeData(data([], { tomb: { gone: old, recent: T0 } }), data([]));
  assert.deepEqual(plain(Object.keys(m.tomb)), ["recent"]);
});
