// src/components/SystemGapDragHandle.tsx
// 選択中の段（整えるモード中は全段）の「上端」に出る境界帯。上下にドラッグすると、
// その境界そのもの（＝上の段とこの段のすき間＝この段のラッパーの margin-top）が
// 指について動く（Issue #523 = #450 の子2。#482 の段階1「選択+パネル」に対する段階2）。
//
// 掴みしろを下端ではなく上端に置いてあるのは、「掴んだ境界が動く」という原則を
// 満たすため（round1 P1）。段の間隔は *後続の段の margin-top* として入る値なので、
// 下端を掴んで自分の margin-top を動かすと、1段目では「譜面全体が下へずれるだけ」で
// 掴んだ境界と動く場所が食い違っていた。上端＝その段の margin-top が支配する境界なので、
// 掴んだ線とパネルの「間隔」の数値と実際に動く場所の3つが一致する。
//
// 値の反映・保存・Undo はパネル（SystemLayoutPanel）とまったく同じ state
// （systemRowGapOverrides）を通す。ここが持つのは「どれだけ動かしたか」を
// px に直す入力装置の部分だけで、値の上下限や保存の経路は一切持たない。
//
// ポインタの作法（#536）・遊び・Undo を1操作にまとめる手順は、角のリサイズハンドル
// （NotationSizeDragHandle・#571）と共通なので useValueDragSession へ寄せてある。
import { useValueDragSession } from '../hooks/useValueDragSession';

type Props = {
  /** この段の先頭小節。data-testid に使う（譜面全体で一意） */
  startMeasure: number;
  /** 読み上げ名に使う段の名前（例:「段3」） */
  systemLabel: string;
  /**
   * この段にいま入っている「段の間隔」の上書き値(px)。上書きが無い段は 0。
   * ドラッグの起点はこの値にする（round1 P2）。実際に効いている margin-top
   * （全体設定＋上書きの合計）を起点にすると、その合計値が上書きとして
   * 保存されてしまい、あとから全体設定を変えてもこの段だけ追従しなくなる。
   */
  currentGapPx: number;
  gapMinPx: number;
  gapMaxPx: number;
  /**
   * 値が実際に変わる直前に1回だけ呼ぶ。Undo 履歴をここで1件だけ積み、
   * ドラッグ全体が「元に戻す」1回で戻るようにする。
   */
  onDragStart: () => void;
  /** ドラッグ中の値。段のラッパーの margin-top と同じ px の絶対値 */
  onDragMove: (gapPx: number) => void;
  /**
   * ドラッグの終わり。changed が false のとき（＝掴む前と同じ値に戻って離した／
   * OS にポインタを取り上げられた）は、onDragStart で積んだ履歴を呼び出し側が取り消す。
   * 何も変わっていないのに「元に戻す」が1回消費される状態を残さないため（round1 P2）。
   */
  onDragEnd: (changed: boolean) => void;
  /**
   * 帯を掴んだ瞬間に1回だけ呼ぶ。整えるモード（Issue #571）では段を選んでいなくても
   * 帯が出ているため、「掴んだ段をそのまま選択状態にする」ために使う。
   */
  onGrab?: () => void;
};

/** パネルの数値表示と同じ書き方（正の値には + を付ける） */
function formatGapPx(gapPx: number): string {
  return `${gapPx >= 0 ? '+' : ''}${gapPx}px`;
}

export default function SystemGapDragHandle({
  startMeasure,
  systemLabel,
  currentGapPx,
  gapMinPx,
  gapMaxPx,
  onDragStart,
  onDragMove,
  onDragEnd,
  onGrab,
}: Props) {
  const { grabbing, valueHint, handlePointerDown } = useValueDragSession({
    baseValue: currentGapPx,
    min: gapMinPx,
    max: gapMaxPx,
    // 縦の移動量がそのまま間隔(px)。下へ引けば間隔が広がる（掴んだ境界が指について動く）
    resolveValue: (base, _dxPx, dyPx) => Math.round(base + dyPx),
    // 帯は上下のドラッグだけを受ける。横の震えで値が変わらないよう縦の移動量だけを見る
    measureDistancePx: (_dx, dy) => Math.abs(dy),
    frameSelector: '.system-select-frame',
    onDragStart,
    onDragMove,
    onDragEnd,
    onGrab,
  });

  return (
    <div
      className={`system-gap-drag-handle${grabbing ? ' system-gap-drag-handle--grabbing' : ''}`}
      // 段の外側クリックでの選択解除（ScorePage）の対象外にする目印。
      // これが無いと、掴んだ瞬間に段の選択が解けて帯ごと消える
      data-system-select-keep="true"
      data-testid={`system-gap-drag-${startMeasure}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`${systemLabel}の上端。上下にドラッグして上の段との間隔を調整`}
      title="ドラッグして上の段との間隔を調整（数値での指定はパネルから）"
      onPointerDown={handlePointerDown}
    >
      {valueHint && (
        // ドラッグ中は「いま何pxか」をカーソルの近くに出す（Issue #318「何が変わっているか見せる」）
        <span
          className="system-gap-drag-value"
          data-testid={`system-gap-drag-value-${startMeasure}`}
          style={{ left: `${valueHint.offsetXPx}px` }}
        >
          {formatGapPx(valueHint.value)}
        </span>
      )}
    </div>
  );
}
