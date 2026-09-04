// src/components/LayoutGapDragBand.tsx
// 選択中の段に出る「境界の掴みしろ（帯）」。上下にドラッグすると、掴んだ境界そのものが
// 指について動く。いまは2種類の境界で使い回している:
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
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * ドラッグとみなすまでの遊び（画面px）。これを超えるまでは値を変えない。
 * 押した指のわずかな震えで間隔が変わるのを防ぐための下限で、
 * 記号のドラッグ移動（Issue #522）の 3px と同じ流儀にそろえてある。
 */
const DRAG_START_THRESHOLD_PX = 3;

type Props = {
  /** 帯の data-testid（例: `system-gap-drag-3` / `part-gap-drag-3-0`） */
  testId: string;
  /** ドラッグ中に出す現在値の吹き出しの data-testid */
  valueTestId: string;
  /** 読み上げ名（aria-label）と、マウスを乗せたときの説明（title） */
  label: string;
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
   * 段の間隔はその段の margin-top そのものなので 1。
   * パート間隔（Issue #572）は「段内の全パート境界へ一律に足す補正」なので、
   * 上から k 番目の境界は 1 目盛りで k 個ぶんの間隔が積み上がって動く
   *（＝ k × 描画倍率）。ここを 1 のままにすると、下のパートほど指より速く動く。
   */
  layoutPxPerValue?: number;
  /**
   * 値が実際に変わる直前に1回だけ呼ぶ。Undo 履歴を積む必要がある呼び出し側
   *（段の間隔）はここで1件だけ積み、ドラッグ全体が「元に戻す」1回で戻るようにする。
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
};

/**
 * 画面の拡大率（ズーム）。譜面は .print-page の transform: scale() で拡大縮小されるため、
 * マウスの移動量（画面px）をそのまま値（レイアウトpx）にすると、拡大時に指と段がずれる。
 * 変倍の実装（CSS 変数）へ依存せずに済むよう、要素自身の「実測の高さ ÷ レイアウト上の高さ」で求める。
 * 実レイアウトを持たない環境（テストの jsdom）では 0 が返るので、その場合は等倍として扱う。
 */
function readVisualScale(frame: HTMLElement): number {
  const layoutHeight = frame.offsetHeight;
  if (layoutHeight <= 0) return 1;
  const scale = frame.getBoundingClientRect().height / layoutHeight;
  return Number.isFinite(scale) && scale > 0.05 ? scale : 1;
}

/** パネル・スライダーの数値表示と同じ書き方（正の値には + を付ける） */
function formatValuePx(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}px`;
}

export default function LayoutGapDragBand({
  testId,
  valueTestId,
  label,
  variantClassName,
  style,
  currentValue,
  minValue,
  maxValue,
  layoutPxPerValue = 1,
  onDragStart,
  onDragMove,
  onDragEnd,
}: Props) {
  // ドラッグ中に出す「いまの値」の吹き出し。null のときは掴んでいない（または遊びの中）
  const [valueHint, setValueHint] = useState<{ value: number; offsetXPx: number } | null>(null);
  // window のイベントを張るきっかけ。掴んでいる間だけ true
  const [grabbing, setGrabbing] = useState(false);
  const sessionRef = useRef<{
    band: HTMLElement;
    /** つかんだ指/ボタンのポインタ列。多点タッチの混線を防ぐためこれだけを追う */
    pointerId: number;
    /** 掴んだ時点の値。移動量は毎回「この値＋総移動量」で決める */
    baseValue: number;
    /** 直前に呼び出し側へ渡した値。同じ値の呼び出しを繰り返さないための控え */
    lastValue: number;
    startClientY: number;
    scale: number;
    /** 1目盛りあたりのレイアウトpx。掴んだ時点の値で固定する（掴んでいる間は変わらない） */
    pxPerValue: number;
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
      const movedValue = movedScreenPx / session.scale / session.pxPerValue;
      const nextValue = Math.max(minValue, Math.min(maxValue, Math.round(
        session.baseValue + movedValue
      )));
      if (nextValue !== session.lastValue) {
        // Undo 履歴はドラッグ全体で1件（#523 受入条件4）。「3px 動いた瞬間」ではなく
        // 「値が実際に変わる最初の時点」で積む。上下限に張り付いたまま指だけ動いた
        // ようなケースで、何も変わらないのに履歴が1件増えるのを防ぐ（round1 P2）
        if (!session.historyPushed && nextValue !== session.baseValue) {
          session.historyPushed = true;
          callbacksRef.current.onDragStart();
        }
        session.lastValue = nextValue;
        callbacksRef.current.onDragMove(nextValue);
      }
      // 吹き出しはカーソルの真横に出す。帯は段と一緒に動くので、帯の左端からの
      // 相対位置（レイアウトpx）に直してから置く
      const bandLeft = session.band.getBoundingClientRect().left;
      setValueHint({ value: nextValue, offsetXPx: (e.clientX - bandLeft) / session.scale });
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
  }, [grabbing, minValue, maxValue]);

  // ドラッグ中にこの部品ごとアンマウントされたとき（Esc / Enter で段の選択が解けるなど）は
  // pointercancel と同じ「なかったこと」扱いにする。これをしないと、積んだ履歴の退避
  // （呼び出し側の rowGapDragHistoryRef）が残留し、次のドラッグの onDragEnd(false) が
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
      title={label}
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
          baseValue: currentValue,
          lastValue: currentValue,
          startClientY: e.clientY,
          scale: readVisualScale(frame),
          // 0 や負の倍率を渡されると値が飛ぶ・逆向きに動くので、ここで安全側へ倒す
          pxPerValue: layoutPxPerValue > 0 ? layoutPxPerValue : 1,
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
          data-testid={valueTestId}
          style={{ left: `${valueHint.offsetXPx}px` }}
        >
          {formatValuePx(valueHint.value)}
        </span>
      )}
    </div>
  );
}
