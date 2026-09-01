// src/components/SystemGapDragHandle.tsx
// 選択中の段の下端に出る「境界帯」。上下にドラッグすると、その段の間隔
// （＝上の段との距離＝段のラッパーの margin-top）が指について変わる
// （Issue #523 = #450 の子2。#482 の段階1「選択+パネル」に対する段階2）。
//
// 値の反映・保存・Undo はパネル（SystemLayoutPanel）とまったく同じ state
// （systemRowGapOverrides）を通す。ここが持つのは「どれだけ動かしたか」を
// px に直す入力装置の部分だけで、値の上下限や保存の経路は一切持たない。
import { useEffect, useRef, useState } from 'react';

/**
 * ドラッグとみなすまでの遊び（画面px）。これを超えるまでは値を変えない。
 * 押した指のわずかな震えで間隔が変わり、Undo 履歴が1件増えるのを防ぐための下限で、
 * 記号のドラッグ移動（Issue #522）の 3px と同じ流儀にそろえてある。
 */
const DRAG_START_THRESHOLD_PX = 3;

type Props = {
  /** この段の先頭小節。data-testid に使う（譜面全体で一意） */
  startMeasure: number;
  /** 読み上げ名に使う段の名前（例:「段3」） */
  systemLabel: string;
  gapMinPx: number;
  gapMaxPx: number;
  /**
   * しきい値を超えて実際に動き始めたときに1回だけ呼ぶ。
   * Undo 履歴をここで1件だけ積み、ドラッグ全体が「元に戻す」1回で戻るようにする。
   */
  onDragStart: () => void;
  /** ドラッグ中の値。段のラッパーの margin-top と同じ px の絶対値 */
  onDragMove: (gapPx: number) => void;
};

/**
 * 段のラッパーにいま効いている margin-top(px)。
 * 個別の上書きがある段はその値、無い段は全体設定（CSS 変数 --system-row-gap）の値が返る。
 * ドラッグの起点をこの「実際に効いている値」にすると、上書きがまだ無い段を掴んだときも
 * 段が飛ばずに指へ 1:1 でついてくる（上書きの inline style は CSS 変数の指定を上書きするため、
 * 起点を常に 0 と決め打つと、全体設定が 0 以外の譜面＝ピアノ譜の既定 -30px などで飛ぶ）。
 */
function readEffectiveMarginTopPx(frame: HTMLElement): number {
  const value = Number.parseFloat(window.getComputedStyle(frame).marginTop);
  return Number.isFinite(value) ? value : 0;
}

/**
 * 画面の拡大率（ズーム）。譜面は .print-page の transform: scale() で拡大縮小されるため、
 * マウスの移動量（画面px）をそのまま間隔（レイアウトpx）にすると、拡大時に指と段がずれる。
 * 変倍の実装（CSS 変数）へ依存せずに済むよう、要素自身の「実測の高さ ÷ レイアウト上の高さ」で求める。
 * 実レイアウトを持たない環境（テストの jsdom）では 0 が返るので、その場合は等倍として扱う。
 */
function readVisualScale(frame: HTMLElement): number {
  const layoutHeight = frame.offsetHeight;
  if (layoutHeight <= 0) return 1;
  const scale = frame.getBoundingClientRect().height / layoutHeight;
  return Number.isFinite(scale) && scale > 0.05 ? scale : 1;
}

/** パネルの数値表示と同じ書き方（正の値には + を付ける） */
function formatGapPx(gapPx: number): string {
  return `${gapPx >= 0 ? '+' : ''}${gapPx}px`;
}

export default function SystemGapDragHandle({
  startMeasure,
  systemLabel,
  gapMinPx,
  gapMaxPx,
  onDragStart,
  onDragMove,
}: Props) {
  // ドラッグ中に出す「いまの値」の吹き出し。null のときは掴んでいない（または遊びの中）
  const [valueHint, setValueHint] = useState<{ gapPx: number; offsetXPx: number } | null>(null);
  // window のイベントを張るきっかけ。掴んでいる間だけ true
  const [grabbing, setGrabbing] = useState(false);
  const sessionRef = useRef<{
    band: HTMLElement;
    /** 掴んだ時点で効いていた間隔(px)。移動量は毎回「この値＋総移動量」で決める */
    baseGapPx: number;
    startClientY: number;
    scale: number;
    /** しきい値を超えて「ドラッグ」になったか（超えるまではただのクリック扱い） */
    moved: boolean;
  } | null>(null);
  // window のハンドラは掴んでいる間ずっと同じものを使い回すため、そのままだと
  // 登録した回の古い関数を掴んだままになる。毎レンダー差し替えて最新を呼ぶ
  const callbacksRef = useRef({ onDragStart, onDragMove });
  callbacksRef.current = { onDragStart, onDragMove };

  // mousemove / mouseup を帯そのものではなく window で受ける。帯は14pxしかなく、
  // 掴んだ直後にカーソルは帯の外へ出るため、要素で受けると1pxも動かせない
  // （弧のドラッグが Issue #235 で同じ結論に至っている）。
  useEffect(() => {
    if (!grabbing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      const movedScreenPx = e.clientY - session.startClientY;
      if (!session.moved) {
        if (Math.abs(movedScreenPx) < DRAG_START_THRESHOLD_PX) return;
        session.moved = true;
        // Undo 履歴はドラッグ全体で1件（受入条件4）。動かし始めのここでだけ積む
        callbacksRef.current.onDragStart();
      }
      const nextGapPx = Math.max(gapMinPx, Math.min(gapMaxPx, Math.round(
        session.baseGapPx + movedScreenPx / session.scale
      )));
      callbacksRef.current.onDragMove(nextGapPx);
      // 吹き出しはカーソルの真横に出す。帯は段と一緒に動くので、帯の左端からの
      // 相対位置（レイアウトpx）に直してから置く
      const bandLeft = session.band.getBoundingClientRect().left;
      setValueHint({ gapPx: nextGapPx, offsetXPx: (e.clientX - bandLeft) / session.scale });
    };
    const handleMouseUp = () => {
      // 離した時点の値がそのまま確定値（ドラッグ中も同じ state を更新しているため、
      // 確定のための追加処理は要らない）。自動保存も通常の編集と同じ経路で走る
      sessionRef.current = null;
      setGrabbing(false);
      setValueHint(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [grabbing, gapMinPx, gapMaxPx]);

  return (
    <div
      className={`system-gap-drag-handle${grabbing ? ' system-gap-drag-handle--grabbing' : ''}`}
      // 段の外側クリックでの選択解除（ScorePage）の対象外にする目印。
      // これが無いと、掴んだ瞬間に段の選択が解けて帯ごと消える
      data-system-select-keep="true"
      data-testid={`system-gap-drag-${startMeasure}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`${systemLabel}の下端。上下にドラッグして段の間隔を調整`}
      title="ドラッグして段の間隔を調整（数値での指定はパネルから）"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const frame = e.currentTarget.closest('.system-select-frame');
        if (!(frame instanceof HTMLElement)) return;
        // ドラッグ中に文字列の範囲選択が始まると画面が青く反転して譜面が見づらいので止める
        e.preventDefault();
        sessionRef.current = {
          band: e.currentTarget,
          baseGapPx: readEffectiveMarginTopPx(frame),
          startClientY: e.clientY,
          scale: readVisualScale(frame),
          moved: false,
        };
        setGrabbing(true);
      }}
    >
      {valueHint && (
        // ドラッグ中は「いま何pxか」をカーソルの近くに出す（Issue #318「何が変わっているか見せる」）
        <span
          className="system-gap-drag-value"
          data-testid={`system-gap-drag-value-${startMeasure}`}
          style={{ left: `${valueHint.offsetXPx}px` }}
        >
          {formatGapPx(valueHint.gapPx)}
        </span>
      )}
    </div>
  );
}
