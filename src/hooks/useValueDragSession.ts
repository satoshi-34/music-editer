// src/hooks/useValueDragSession.ts
// 「譜面の上の掴みしろを引っぱって数値を変える」ドラッグの共通部分（Issue #571）。
//
// 段の境界帯（SystemGapDragHandle・#523）と、段の右下角のリサイズハンドル
// （NotationSizeDragHandle・#571）は、変える値が違うだけで手順はまったく同じ:
//
//   掴む（pointerdown） → 遊び(3px)を超えたらドラッグ開始 → 値が実際に変わる最初の1回で
//   Undo 履歴を1件積む → 離したら確定（値が戻っていれば履歴も取り消す）
//
// これを2か所へ書くと、片方だけ直したときにもう片方へ修正が届かない（#280 の実害）。
// そこで「ポインタの作法（#536）」と「Undo を1操作にまとめる決まり（#523 受入条件4）」を
// このフックへ寄せ、各ハンドルには「どの向きの移動を、どんな値に読み替えるか」だけを残す。
import { useEffect, useRef, useState } from 'react';

/**
 * ドラッグとみなすまでの遊び（画面px）。これを超えるまでは値を変えない。
 * 押した指のわずかな震えで値が変わるのを防ぐための下限で、
 * 記号のドラッグ移動（Issue #522）の 3px と同じ流儀にそろえてある。
 */
export const DRAG_START_THRESHOLD_PX = 3;

/**
 * 画面の拡大率（ズーム）。譜面は .print-page の transform: scale() で拡大縮小されるため、
 * マウスの移動量（画面px）をそのまま値に使うと、拡大時に指と譜面がずれる。
 * 変倍の実装（CSS 変数）へ依存せずに済むよう、要素自身の「実測の高さ ÷ レイアウト上の高さ」で求める。
 * 実レイアウトを持たない環境（テストの jsdom）では 0 が返るので、その場合は等倍として扱う。
 */
export function readVisualScale(frame: HTMLElement): number {
  const layoutHeight = frame.offsetHeight;
  if (layoutHeight <= 0) return 1;
  const scale = frame.getBoundingClientRect().height / layoutHeight;
  return Number.isFinite(scale) && scale > 0.05 ? scale : 1;
}

type Options = {
  /** 掴んだ時点の値。移動量は毎回「この値＋総移動量」で決める（実効値ではなく上書き値を渡すこと） */
  baseValue: number;
  min: number;
  max: number;
  /**
   * ズーム補正済みの移動量（レイアウトpx）から次の値を決める。丸め方（px単位・%単位）は
   * 値の意味ごとに違うので呼び出し側が持つ。上下限のクランプはフック側で行う
   */
  resolveValue: (baseValue: number, dxPx: number, dyPx: number) => number;
  /**
   * 遊び（3px）の判定に使う移動量。縦だけを見るハンドル・斜めに引くハンドルで
   * 「どれだけ動いたか」の意味が違うため、呼び出し側が決める（画面px・補正前）
   */
  measureDistancePx: (dxScreenPx: number, dyScreenPx: number) => number;
  /** ズーム補正の基準にする祖先要素のセレクタ（段のラッパーなど） */
  frameSelector: string;
  /** 値が実際に変わる直前に1回だけ呼ぶ。Undo 履歴をここで1件だけ積む */
  onDragStart: () => void;
  /** ドラッグ中の値 */
  onDragMove: (value: number) => void;
  /** ドラッグの終わり。changed=false のときは onDragStart で積んだ履歴を呼び出し側が取り消す */
  onDragEnd: (changed: boolean) => void;
  /** 掴んだ瞬間（遊びの判定より前）に1回だけ呼ぶ。段の選択などに使う */
  onGrab?: () => void;
};

type ValueHint = {
  value: number;
  /** 掴みしろの左端からの相対位置（レイアウトpx）。吹き出しをカーソルの近くへ置くのに使う */
  offsetXPx: number;
};

export function useValueDragSession({
  baseValue,
  min,
  max,
  resolveValue,
  measureDistancePx,
  frameSelector,
  onDragStart,
  onDragMove,
  onDragEnd,
  onGrab,
}: Options) {
  // ドラッグ中に出す「いまの値」の吹き出し。null のときは掴んでいない（または遊びの中）
  const [valueHint, setValueHint] = useState<ValueHint | null>(null);
  // window のイベントを張るきっかけ。掴んでいる間だけ true
  const [grabbing, setGrabbing] = useState(false);
  const sessionRef = useRef<{
    handle: HTMLElement;
    /** つかんだ指/ボタンのポインタ列。多点タッチの混線を防ぐためこれだけを追う */
    pointerId: number;
    baseValue: number;
    /** 直前に呼び出し側へ渡した値。同じ値の呼び出しを繰り返さないための控え */
    lastValue: number;
    startClientX: number;
    startClientY: number;
    scale: number;
    /** しきい値を超えて「ドラッグ」になったか（超えるまではただのクリック扱い） */
    moved: boolean;
    /** Undo 履歴を積んだか。値が実際に変わる最初の1回だけ積む */
    historyPushed: boolean;
  } | null>(null);
  // window のハンドラは掴んでいる間ずっと同じものを使い回すため、そのままだと
  // 登録した回の古い関数を掴んだままになる。毎レンダー差し替えて最新を呼ぶ
  const callbacksRef = useRef({ onDragStart, onDragMove, onDragEnd, resolveValue, measureDistancePx });
  callbacksRef.current = { onDragStart, onDragMove, onDragEnd, resolveValue, measureDistancePx };

  // pointermove / pointerup を掴みしろそのものではなく window で受ける。掴みしろは十数pxしかなく、
  // 掴んだ直後にカーソルはその外へ出るため、要素で受けると1pxも動かせない
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
      const dxScreenPx = e.clientX - session.startClientX;
      const dyScreenPx = e.clientY - session.startClientY;
      if (!session.moved) {
        if (callbacksRef.current.measureDistancePx(dxScreenPx, dyScreenPx) < DRAG_START_THRESHOLD_PX) return;
        session.moved = true;
      }
      const nextValue = Math.max(min, Math.min(max, callbacksRef.current.resolveValue(
        session.baseValue,
        dxScreenPx / session.scale,
        dyScreenPx / session.scale
      )));
      if (nextValue !== session.lastValue) {
        // Undo 履歴はドラッグ全体で1件（#523 受入条件4）。「3px 動いた瞬間」ではなく
        // 「値が実際に変わる最初の時点」で積む。上下限に張り付いたまま指だけ動いた
        // ようなケースで、何も変わらないのに履歴が1件増えるのを防ぐ（#523 round1 P2）
        if (!session.historyPushed && nextValue !== session.baseValue) {
          session.historyPushed = true;
          callbacksRef.current.onDragStart();
        }
        session.lastValue = nextValue;
        callbacksRef.current.onDragMove(nextValue);
      }
      // 吹き出しはカーソルの近くに出す。掴みしろは譜面と一緒に動くので、
      // 掴みしろの左端からの相対位置（レイアウトpx）に直してから置く
      const handleLeft = session.handle.getBoundingClientRect().left;
      setValueHint({ value: nextValue, offsetXPx: (e.clientX - handleLeft) / session.scale });
    };
    const handlePointerUp = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.pointerId !== session.pointerId) return;
      // 離した時点の値がそのまま確定値（ドラッグ中も同じ state を更新しているため、
      // 確定のための追加処理は要らない）。自動保存も通常の編集と同じ経路で走る
      finish(session.lastValue !== session.baseValue);
    };
    // pointercancel は OS がポインタを取り上げた合図で、pointerup も click も来ない。
    // 利用者の「ここで決めた」ではないので、掴む前の値へ戻して履歴も取り消す
    // （ドラッグ状態と window のリスナーが残るのもここで防ぐ）
    const handlePointerCancel = (e: PointerEvent) => {
      const session = sessionRef.current;
      if (!session) return;
      if (e.pointerId !== session.pointerId) return;
      if (session.lastValue !== session.baseValue) {
        callbacksRef.current.onDragMove(session.baseValue);
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
  }, [grabbing, min, max]);

  // ドラッグ中にこの部品ごとアンマウントされたとき（Esc / Enter で段の選択が解けるなど）は
  // pointercancel と同じ「なかったこと」扱いにする。これをしないと、積んだ履歴の退避
  // （呼び出し側の *DragHistoryRef）が残留し、次のドラッグの onDragEnd(false) が
  // **前回の退避**で履歴を巻き戻して、確定済みの1件まで消してしまう（#523 round2 P2）
  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    if (session.lastValue !== session.baseValue) {
      callbacksRef.current.onDragMove(session.baseValue);
    }
    callbacksRef.current.onDragEnd(false);
  }, []);

  /** 掴みしろの onPointerDown へそのまま渡すハンドラ */
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    // 主ポインタの左ボタン/指だけでつかむ（#536 の規約）。右クリックや補助ボタンの
    // ドラッグで値が変わると、コンテキストメニュー操作のつもりが編集になる
    if (!e.isPrimary || e.button !== 0) return;
    const frame = e.currentTarget.closest(frameSelector);
    if (!(frame instanceof HTMLElement)) return;
    // ドラッグ中に文字列の範囲選択が始まると画面が青く反転して譜面が見づらいので止める
    e.preventDefault();
    sessionRef.current = {
      handle: e.currentTarget,
      pointerId: e.pointerId,
      baseValue,
      lastValue: baseValue,
      startClientX: e.clientX,
      startClientY: e.clientY,
      scale: readVisualScale(frame),
      moved: false,
      historyPushed: false,
    };
    setGrabbing(true);
    // 選択の更新は掴んだ直後に行う（遊びの判定より前）。掴んだだけでドラッグしなくても
    // 段が選ばれるので、「掴む＝その段を調整しはじめる」が1操作で済む（#571）
    onGrab?.();
  };

  return { grabbing, valueHint, handlePointerDown };
}
