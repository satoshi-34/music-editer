// src/components/NotationSizeDragHandle.tsx
// 選択中の段の枠の右下角に出るリサイズハンドル（◢）。斜めに引くと
// 「音符の大きさ」＝ notationSizeMultiplier が変わる（Issue #571 の運用者裁定）。
//
// **この操作は譜面全体に効く**（掴んだ段だけが大きくなるのではない）。角のハンドルは
// 「掴んだ枠だけが変わる」と読めてしまうのが最大の誤解なので、ドラッグ中の吹き出しに
// 必ず「（全体）」を出し、プレビューも全段が同時に変わる（1段だけ変わる見せ方をしない）。
//
// **この部品はドラッグの状態を持たない**（round1 P1 の修正）。音符の大きさが変わると
// 段割り・ページ割りが計算し直され、掴んでいた段そのものが画面から消えることがある。
// 状態をここに持たせると、そのアンマウントでドラッグが「なかったこと」にされ、
// 値が掴む前へ跳ね戻ってしまっていた。いまはドラッグの主（useValueDragSession）を
// ScorePage が1つだけ持ち、この部品は掴み口（onPointerDown）と見た目だけを担当する。
// 吹き出しも ScorePage が画面へ直に出すので、この要素が消えても表示は途切れない。
import { toNotationSizePercent } from '../utils/notationSizeDrag';

type Props = {
  /** この段の先頭小節。data-testid に使う（譜面全体で一意） */
  startMeasure: number;
  /** 読み上げ名に使う段の名前（例:「段3」） */
  systemLabel: string;
  /** いまの倍率（1.5 = 150%）。読み上げ用の現在値に使う */
  multiplier: number;
  minMultiplier: number;
  maxMultiplier: number;
  /** ドラッグ中か（見た目を濃くするだけ）。判定は ScorePage が持つ */
  grabbing: boolean;
  /** ScorePage が持つドラッグセッションの掴み口。そのまま渡す */
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
};

export default function NotationSizeDragHandle({
  startMeasure,
  systemLabel,
  multiplier,
  minMultiplier,
  maxMultiplier,
  grabbing,
  onPointerDown,
}: Props) {
  return (
    <div
      className={`notation-size-drag-handle${grabbing ? ' notation-size-drag-handle--grabbing' : ''}`}
      // 段の外側クリックでの選択解除（ScorePage）の対象外にする目印。
      // これが無いと、掴んだ瞬間に段の選択が解けてハンドルごと消える
      data-system-select-keep="true"
      data-testid={`notation-size-drag-${startMeasure}`}
      role="slider"
      aria-label={`音符の大きさ（譜面全体）。${systemLabel}の右下角を斜めにドラッグして拡大縮小`}
      aria-valuemin={toNotationSizePercent(minMultiplier)}
      aria-valuemax={toNotationSizePercent(maxMultiplier)}
      aria-valuenow={toNotationSizePercent(multiplier)}
      aria-valuetext={`${toNotationSizePercent(multiplier)}%`}
      title="斜めにドラッグして音符の大きさを変更（この段だけでなく譜面全体に効きます）"
      onPointerDown={onPointerDown}
    />
  );
}
