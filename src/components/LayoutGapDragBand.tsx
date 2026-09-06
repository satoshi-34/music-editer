// src/components/LayoutGapDragBand.tsx
// 選択中の段（整えるモード中は全段）に出る「境界の掴みしろ（帯）」。上下にドラッグすると、
// 掴んだ境界そのものが指について動く。いまは2種類の境界で使い回している:
//
//   1. 段の上端＝上の段との境界（Issue #523 = #450 の子2）。動かすのは「段の間隔」
//      （その段のラッパーの margin-top＝systemRowGapOverrides）
//   2. 段の中のパート境界（Issue #572）。動かすのは「パート間隔」
//      （partSpacingOffsetPx＝レイアウトタブのスライダーと同じ全体設定）
//
// 掴みしろを（1）で段の下端ではなく上端に置いてあるのは、「掴んだ境界が動く」という原則を
// 満たすため（#523 round1 P1）。段の間隔は *後続の段の margin-top* として入る値なので、
// 下端を掴んで自分の margin-top を動かすと、1段目では「譜面全体が下へずれるだけ」で
// 掴んだ境界と動く場所が食い違っていた。上端＝その段の margin-top が支配する境界なので、
// 掴んだ線とパネルの「間隔」の数値と実際に動く場所の3つが一致する。
//
// 値の反映・保存・Undo はパネル（SystemLayoutPanel）やレイアウトタブのスライダーと
// まったく同じ state を通す。ここが持つのは「どれだけ動かしたか」を値に直す入力装置の
// 部分だけで、値の上下限の意味づけや保存の経路は一切持たない（#572 でパート間隔へ
// 広げるときも、この部品には「1目盛りあたり何px動くか」を渡すだけで済んでいる）。
//
// ポインタの作法（#536）・遊び・Undo を1操作にまとめる手順は、角のリサイズハンドル
// （NotationSizeDragHandle・#571）と共通なので useValueDragSession へ寄せてある。
import type { CSSProperties } from 'react';
import { useValueDragSession, type ValueDragLock } from '../hooks/useValueDragSession';

type Props = {
  /** 帯の data-testid（例: `system-gap-drag-3` / `part-gap-drag-3-0`） */
  testId: string;
  /** ドラッグ中に出す現在値の吹き出しの data-testid */
  valueTestId: string;
  /** 読み上げ名（aria-label） */
  label: string;
  /** マウスを乗せたときの説明（title） */
  title: string;
  /** 置き場所を決める追加クラス（パート境界は `system-gap-drag-handle--part`） */
  variantClassName?: string;
  /** 置き場所の微調整（パート境界は境界の y をインラインの top で渡す） */
  style?: CSSProperties;
  /**
   * いま効いている値。ドラッグの起点はこの値にする（#523 round1 P2）。
   * 実際に効いている見た目の位置（全体設定＋上書きの合計）を起点にすると、
   * その合計値が上書きとして保存されてしまい、あとから全体設定を変えても追従しなくなる。
   */
  currentValue: number;
  minValue: number;
  maxValue: number;
  /**
   * 値1目盛りあたり、掴んだ境界がレイアウト上で何px動くか。
   * 段の間隔はその段の margin-top そのものなので 1（既定）。
   * パート間隔（Issue #572）は「段内の全パート境界へ一律に足す補正」なので、
   * 上から k 番目の境界は 1 目盛りで k 個ぶんの間隔が積み上がって動く
   *（＝ k × 描画倍率）。ここを 1 のままにすると、下のパートほど指より速く動く。
   */
  layoutPxPerValue?: number;
  /**
   * 値が実際に変わる直前に1回だけ呼ぶ。Undo 履歴をここで1件だけ積み、
   * ドラッグ全体が「元に戻す」1回で戻るようにする。
   */
  onDragStart: () => void;
  /** ドラッグ中の値（絶対値）。呼び出し側の state をそのまま更新する */
  onDragMove: (value: number) => void;
  /**
   * ドラッグの終わり。changed が false のとき（＝掴む前と同じ値に戻って離した／
   * OS にポインタを取り上げられた）は、onDragStart で積んだ履歴を呼び出し側が取り消す。
   * 何も変わっていないのに「元に戻す」が1回消費される状態を残さないため（#523 round1 P2）。
   */
  onDragEnd: (changed: boolean) => void;
  /**
   * 帯を掴んだ瞬間に1回だけ呼ぶ。整えるモード（Issue #571）では段を選んでいなくても
   * 帯が出ているため、「掴んだ段をそのまま選択状態にする」ために使う。
   */
  onGrab?: () => void;
  /**
   * 同時ドラッグを防ぐ共有ロック。角の◢（音符の大きさ）・他の帯と Undo の退避先を
   * 共有しているため、どれか1つしか掴めないようにする（#571 round2 P2-1）。
   * 呼び出し側（ScorePage）が1個だけ作り、すべての帯と◢へ同じ箱を渡す。
   */
  dragLock?: ValueDragLock;
};

/** パネル・スライダーの数値表示と同じ書き方（正の値には + を付ける） */
function formatValuePx(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}px`;
}

export default function LayoutGapDragBand({
  testId,
  valueTestId,
  label,
  title,
  variantClassName,
  style,
  currentValue,
  minValue,
  maxValue,
  layoutPxPerValue = 1,
  onDragStart,
  onDragMove,
  onDragEnd,
  onGrab,
  dragLock,
}: Props) {
  const { grabbing, valueHint, handlePointerDown } = useValueDragSession({
    baseValue: currentValue,
    min: minValue,
    max: maxValue,
    // 縦の移動量（ズーム補正済みのレイアウトpx）を「1目盛りあたりの移動量」で割って値に直す。
    // 段の間隔は 1px 動かせば境界も 1px 動く（＝ 1）が、パート間隔は掴んだ境界より上に
    // 何個の間隔が積み上がるかで換算が変わる。0 や負の値を渡されると値が飛ぶ・逆向きに
    // 動くので、ここで安全側（等倍）へ倒す
    resolveValue: (base, _dxPx, dyPx) => Math.round(
      base + dyPx / (layoutPxPerValue > 0 ? layoutPxPerValue : 1)
    ),
    // 帯は上下のドラッグだけを受ける。横の震えで値が変わらないよう縦の移動量だけを見る
    measureDistancePx: (_dx, dy) => Math.abs(dy),
    frameSelector: '.system-select-frame',
    onDragStart,
    onDragMove,
    onDragEnd,
    onGrab,
    lock: dragLock,
  });

  return (
    <div
      className={[
        'system-gap-drag-handle',
        variantClassName,
        grabbing ? 'system-gap-drag-handle--grabbing' : null,
      ].filter(Boolean).join(' ')}
      style={style}
      // 段の外側クリックでの選択解除（ScorePage）の対象外にする目印。
      // これが無いと、掴んだ瞬間に段の選択が解けて帯ごと消える
      data-system-select-keep="true"
      data-testid={testId}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={title}
      onPointerDown={handlePointerDown}
    >
      {valueHint && (
        // ドラッグ中は「いま何pxか」をカーソルの近くに出す（Issue #318「何が変わっているか見せる」）
        <span
          className="system-gap-drag-value"
          data-testid={valueTestId}
          style={{ left: `${valueHint.offsetXPx}px` }}
        >
          {formatValuePx(valueHint.value)}
        </span>
      )}
    </div>
  );
}
