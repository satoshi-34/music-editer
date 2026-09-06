// src/utils/inputAccidentalTool.ts
// 「入力用の臨時記号（♯/♭/♮・微分音）を持ったまま音価を持ち替える」ときの引き継ぎ規則（Issue #548）。
//
// なぜ utils に置くか:
//   同じ引き継ぎが2か所から必要になる。パレットの音価ボタン（マウス）と、
//   数字キーの音価ショートカット（キーボード。ScorePage 側）である。
//   どちらかに書くともう一方から呼べず「同じロジックの2枚目」ができ、
//   片方だけ直したときに入力方法で挙動が食い違う（#548 round1 P2-4 の実害）。

import type { Tool } from '../components/Palette';

/**
 * `next`（新しく選ぼうとしている音価ツール）へ、`current` に載っている
 * 入力用の臨時記号を引き継いだツールを返す。
 *
 * 引き継がない場合はそのまま `next` を返す:
 *   - `next` が音価ツールでない（記号系ツール）とき
 *   - `next` が休符のとき（休符に臨時記号は付かない）
 *   - `current` が音価ツールでない、または記号を持っていないとき
 */
export function carryInputAccidental(current: Tool, next: Tool): Tool {
  if (!('duration' in next) || next.isRest) return next;
  if (!('duration' in current)) return next;
  if (!current.accidental && !current.microtone) return next;
  return { ...next, accidental: current.accidental, microtone: current.microtone };
}
