// src/components/SystemGapDragHandle.tsx
// 選択中の段の「上端」に出る境界帯。上下にドラッグすると、その境界そのもの
// （＝上の段とこの段のすき間＝この段のラッパーの margin-top）が指について動く
// （Issue #523 = #450 の子2。#482 の段階1「選択+パネル」に対する段階2）。
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
import { useEffect, useRef, useState } from 'react';

/**
 * ドラッグとみなすまでの遊び（画面px）。これを超えるまでは値を変えない。
 * 押した指のわずかな震えで間隔が変わるのを防ぐための下限で、
 * 記号のドラッグ移動（Issue #522）の 3px と同じ流儀にそろえてある。
 */
const DRAG_START_THRESHOLD_PX = 3;

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
};

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
  currentGapPx,
  gapMinPx,
  gapMaxPx,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  // ドラッグ中に出す「いまの値」の吹き出し。null のときは掴んでいない（または遊びの中）
  const [valueHint, setValueHint] = useState<{ gapPx: number; offsetXPx: number } | null>(null);
  // window のイベントを張るきっかけ。掴んでいる間だけ true
  const [grabbing, setGrabbing] = useState(false);
  const sessionRef = useRef<{
    band: HTMLElement;
    /** つかんだ指/ボタンのポインタ列。多点タッチの混線を防ぐためこれだけを追う */
    pointerId: number;
    /** 掴んだ時点の上書き値(px)。移動量は毎回「この値＋総移動量」で決める */
    baseGapPx: number;
    /** 直前に呼び出し側へ渡した値。同じ値の呼び出しを繰り返さないための控え */
    lastGapPx: number;
    startClientY: number;
    scale: number;
    /** しきい値を超えて「ドラッグ」になったか（超えるまではただのクリック扱い） */
    moved: boolean;
    /** Undo 履歴を積んだか。値が実際に変わる最初の1回だけ積む */
    historyPushed: boolean;
  } | null>(null);
  // window のハンドラは掴んでいる間ずっと同じものを使い回すため、そのままだと
  // 登録した回の古い関数を掴んだままになる。毎レンダー差し替えて最新を呼ぶ
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd };

  // pointermove / pointerup を帯そのものではなく window で受ける。帯は14pxしかなく、
  // 掴んだ直後にカーソルは帯の外へ出るため、要素で受けると1pxも動かせない
  // （弧のドラッグが Issue #235 で同じ結論に至っている）。
  // mouse 系ではなく pointer 系で受けるのは #536 で確立した規約に合わせるため。
  // タッチの互換マウスイベントは指の移動中の連続 mousemove を配送しないので、
  // mouse 専用のままだとタッチでドラッグできない。
  useEffect(() => {
    if (!grabbing) return;
    /** 掴んだ状態の後始末。ウィンドウ外で離しても必ずここを通る */
    const finish = (changed: boolean) => {
      sessionRef.current = null;
      setGrabbing(false);
      setValueHint(null);
      callbacksRef.current.onDragEnd(changed);
    };
    const handlePointerMove = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.pointerId !== session.pointerId) return;
      const movedScreenPx = e.clientY - session.startClientY;
      if (!session.moved) {
        if (Math.abs(movedScreenPx) < DRAG_START_THRESHOLD_PX) return;
        session.moved = true;
      }
      const nextGapPx = Math.max(gapMinPx, Math.min(gapMaxPx, Math.round(
        session.baseGapPx + movedScreenPx / session.scale
      )));
      if (nextGapPx !== session.lastGapPx) {
        // Undo 履歴はドラッグ全体で1件（受入条件4）。「3px 動いた瞬間」ではなく
        // 「値が実際に変わる最初の時点」で積む。上下限に張り付いたまま指だけ動いた
        // ようなケースで、何も変わらないのに履歴が1件増えるのを防ぐ（round1 P2）
        if (!session.historyPushed && nextGapPx !== session.baseGapPx) {
          session.historyPushed = true;
          callbacksRef.current.onDragStart();
        }
        session.lastGapPx = nextGapPx;
        callbacksRef.current.onDragMove(nextGapPx);
      }
      // 吹き出しはカーソルの真横に出す。帯は段と一緒に動くので、帯の左端からの
      // 相対位置（レイアウトpx）に直してから置く
      const bandLeft = session.band.getBoundingClientRect().left;
      setValueHint({ gapPx: nextGapPx, offsetXPx: (e.clientX - bandLeft) / session.scale });
    };
    const handlePointerUp = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.pointerId !== session.pointerId) return;
      // 離した時点の値がそのまま確定値（ドラッグ中も同じ state を更新しているため、
      // 確定のための追加処理は要らない）。自動保存も通常の編集と同じ経路で走る
      finish(session.lastGapPx !== session.baseGapPx);
    };
    // pointercancel は OS がポインタを取り上げた合図で、pointerup も click も来ない。
    // 利用者の「ここで決めた」ではないので、掴む前の値へ戻して履歴も取り消す
    // （ドラッグ状態と window のリスナーが残るのもここで防ぐ）
    const handlePointerCancel = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.pointerId !== session.pointerId) return;
      if (session.lastGapPx !== session.baseGapPx) {
        callbacksRef.current.onDragMove(session.baseGapPx);
      }
      finish(false);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
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
      aria-label={`${systemLabel}の上端。上下にドラッグして上の段との間隔を調整`}
      title="ドラッグして上の段との間隔を調整（数値での指定はパネルから）"
      onPointerDown={(e) => {
        // 主ポインタの左ボタン/指だけでつかむ（#536 の規約）。右クリックや補助ボタンの
        // ドラッグで値が変わると、コンテキストメニュー操作のつもりが編集になる
        if (!e.isPrimary || e.button !== 0) return;
        const frame = e.currentTarget.closest('.system-select-frame');
        if (!(frame instanceof HTMLElement)) return;
        // ドラッグ中に文字列の範囲選択が始まると画面が青く反転して譜面が見づらいので止める
        e.preventDefault();
        sessionRef.current = {
          band: e.currentTarget,
          pointerId: e.pointerId,
          baseGapPx: currentGapPx,
          lastGapPx: currentGapPx,
          startClientY: e.clientY,
          scale: readVisualScale(frame),
          moved: false,
          historyPushed: false,
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
