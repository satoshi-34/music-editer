// src/components/NotationSizeDragHandle.tsx
// 選択中の段の枠の右下角に出るリサイズハンドル（◢）。斜めに引くと
// 「音符の大きさ」＝ notationSizeMultiplier が変わる（Issue #571 の運用者裁定）。
//
// **この操作は譜面全体に効く**（掴んだ段だけが大きくなるのではない）。角のハンドルは
// 「掴んだ枠だけが変わる」と読めてしまうのが最大の誤解なので、ドラッグ中の吹き出しに
// 必ず「（全体）」を出し、プレビューも全段が同時に変わる（1段だけ変わる見せ方をしない）。
//
// 値の保存先はレイアウトタブの「音符の大きさ」スライダーとまったく同じ state で、
// ここが持つのは「どれだけ動かしたか」を % に直す入力装置の部分だけ。
// ポインタの作法（#536）・遊び・Undo を1操作にまとめる手順は段の境界帯（#523）と
// 共通なので useValueDragSession へ寄せてある。
import { useValueDragSession } from '../hooks/useValueDragSession';

/**
 * 1px 引くと何 % 変わるか。100px で 40%（80%〜200% の全域は 300px）動く見当で、
 * 「少し引いたら少し変わる」と感じられる粗さに合わせた。細かく決めたい人は
 * スライダー（5%刻み）で追い込めるので、ここは粗くてよい。
 */
const PERCENT_PER_PX = 0.4;

/**
 * 値を丸める刻み（%）。レイアウトタブのスライダー（step=5）と同じ刻みにそろえてある。
 * 1%刻みにすると、ドラッグで作った 112% のような値をスライダーが表示できず
 * （range 入力は step の倍数へ丸めてつまみを置く）、つまみと数字が食い違って見える。
 * 同じ値を2つのUIで指すのだから、刻みも合わせておく（実機確認で判明・Issue #571）。
 */
const PERCENT_STEP = 5;

type Props = {
  /** この段の先頭小節。data-testid に使う（譜面全体で一意） */
  startMeasure: number;
  /** 読み上げ名に使う段の名前（例:「段3」） */
  systemLabel: string;
  /** いまの倍率（1.5 = 150%）。ドラッグの起点になる */
  multiplier: number;
  minMultiplier: number;
  maxMultiplier: number;
  /** 値が実際に変わる直前に1回だけ呼ぶ（Undo 履歴を1件だけ積む） */
  onDragStart: () => void;
  /** ドラッグ中の倍率 */
  onDragMove: (multiplier: number) => void;
  /** ドラッグの終わり。changed=false なら呼び出し側が履歴を取り消す */
  onDragEnd: (changed: boolean) => void;
};

/** 内部の倍率（0.8〜2.0）を画面表示の % に直す。スライダーの表示と同じ丸め方 */
function toPercent(multiplier: number): number {
  return Math.round(multiplier * 100);
}

export default function NotationSizeDragHandle({
  startMeasure,
  systemLabel,
  multiplier,
  minMultiplier,
  maxMultiplier,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  const { grabbing, valueHint, handlePointerDown } = useValueDragSession({
    baseValue: multiplier,
    min: minMultiplier,
    max: maxMultiplier,
    // 右下（外）へ引けば拡大・左上（内）へ引けば縮小。斜めのハンドルなので
    // 縦横どちらの動きも同じだけ効くように平均を取る（どちらか一方だけを見ると、
    // 利用者が「斜めに引いたつもり」でも半分しか変わらない）。
    // スライダーと同じ 5% 刻みに丸める（つまみと数字が食い違わないように）
    resolveValue: (base, dxPx, dyPx) => (
      Math.round((toPercent(base) + ((dxPx + dyPx) / 2) * PERCENT_PER_PX) / PERCENT_STEP) * PERCENT_STEP / 100
    ),
    // 斜めのドラッグなので、遊びの判定も斜めの移動距離で見る
    measureDistancePx: (dx, dy) => Math.hypot(dx, dy),
    frameSelector: '.system-select-frame',
    onDragStart,
    onDragMove,
    onDragEnd,
  });

  return (
    <div
      className={`notation-size-drag-handle${grabbing ? ' notation-size-drag-handle--grabbing' : ''}`}
      // 段の外側クリックでの選択解除（ScorePage）の対象外にする目印。
      // これが無いと、掴んだ瞬間に段の選択が解けてハンドルごと消える
      data-system-select-keep="true"
      data-testid={`notation-size-drag-${startMeasure}`}
      role="slider"
      aria-label={`音符の大きさ（譜面全体）。${systemLabel}の右下角を斜めにドラッグして拡大縮小`}
      aria-valuemin={toPercent(minMultiplier)}
      aria-valuemax={toPercent(maxMultiplier)}
      aria-valuenow={toPercent(multiplier)}
      aria-valuetext={`${toPercent(multiplier)}%`}
      title="斜めにドラッグして音符の大きさを変更（この段だけでなく譜面全体に効きます）"
      onPointerDown={handlePointerDown}
    >
      {valueHint && (
        // ドラッグ中は「いま何%か」を出す。**（全体）を必ず添える**のがこのハンドルの肝で、
        // 「掴んだ段だけが変わる」という誤解を残さないため（運用者裁定 2026-09-02）
        <span
          className="notation-size-drag-value"
          data-testid={`notation-size-drag-value-${startMeasure}`}
          style={{ left: `${valueHint.offsetXPx}px` }}
        >
          {`音符の大きさ（全体）: ${toPercent(valueHint.value)}%`}
        </span>
      )}
    </div>
  );
}
