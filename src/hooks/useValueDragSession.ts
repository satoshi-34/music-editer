// src/hooks/useValueDragSession.ts
// 「譜面の上の掴みしろを引っぱって数値を変える」ドラッグの共通部分（Issue #571）。
//
// 段の境界帯（LayoutGapDragBand・#523）と、段の右下角のリサイズハンドル
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
 * 「同時に掴めるのは1つだけ」を守るための共有ロック（Issue #571 round2 P2-1）。
 *
 * 段の境界帯は段の数だけ、角の◢は1つ、とドラッグの主（このフック）は画面に複数ある。
 * それぞれが「自分のポインタ列（pointerId）だけを見る」作りなので、セッション同士は
 * 互いを知らない。ところが Pointer Events では **primary のポインタが同時に2本
 * 成立し得る**（タッチとマウスのように種類が違えば、どちらも isPrimary=true になる。
 * 指でも操作できるノートPCなど）。2本目が別のハンドルを掴むと、
 * Undo の退避先（ScorePage の layoutDragHistoryRef）が1つしか無いため上書きされ、
 * 片方の確定が退避を消した後にもう片方が中止されると、確定済みの履歴まで巻き戻る。
 *
 * そこで「いま誰が掴んでいるか」だけを持つ小さな箱を全セッションで共有し、
 * 既に誰かが掴んでいる間の2本目の pointerdown は**掴ませない**（先着優先）。
 */
export type ValueDragLock = {
  /** 掴んでいるセッションの目印。誰も掴んでいなければ null */
  ownerToken: object | null;
};

/** 共有ロックの箱を1つ作る。呼び出し側（ScorePage）が useRef で1つだけ持ち、各ハンドルへ配る */
export function createValueDragLock(): ValueDragLock {
  return { ownerToken: null };
}

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
  /**
   * 同時ドラッグを防ぐ共有ロック（上記 ValueDragLock）。同じ Undo 退避先を使う
   * ハンドル同士へ**同じ箱**を渡すこと。渡さない場合は従来どおり排他しない
   */
  lock?: ValueDragLock;
};

type ValueHint = {
  value: number;
  /**
   * 掴みしろの左端からの相対位置（レイアウトpx）。吹き出しを掴みしろの中へ
   * 絶対配置で置く呼び出し側（段の境界帯）が使う。
   * 掴みしろが画面から消えたあと（下記 clientX/clientY の説明を参照）は
   * 直前の値のまま据え置くので、吹き出しが左端へ飛ぶことはない。
   */
  offsetXPx: number;
  /**
   * ポインタの画面座標（clientX/clientY）。掴みしろの中ではなく画面へ直に
   * （position: fixed で）吹き出しを出す呼び出し側が使う。
   *
   * なぜ2種類あるか: 角のリサイズハンドル（#571）は値を変えると段割りが変わり、
   * 掴んでいたハンドル要素そのものが消えることがある。消えた要素を基準にすると
   * 吹き出しの置き場所が決まらないので、画面座標で置けるようにしてある。
   */
  clientX: number;
  clientY: number;
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
  lock,
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
  // 共有ロック（同時ドラッグの排他・round2 P2-1）。掴んだのが自分かどうかを見分けるため、
  // このフック1つにつき1個だけの目印（空オブジェクト）を持つ
  const lockRef = useRef(lock);
  lockRef.current = lock;
  const ownTokenRef = useRef<object>({});
  // 自分が掴んでいるときだけロックを外す。別のセッションが掴んでいるときに
  // 横から外すと、そちらの排他が効かなくなるため必ず持ち主を確認する
  const releaseLock = useRef(() => {
    const current = lockRef.current;
    if (current && current.ownerToken === ownTokenRef.current) current.ownerToken = null;
  }).current;

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
      releaseLock();
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
      // 掴みしろの左端からの相対位置（レイアウトpx）に直してから置く。
      // ただし掴みしろが画面から外された（isConnected === false）あとは
      // getBoundingClientRect が 0 を返し、吹き出しが画面の左端へ飛んでしまうので、
      // そのときは直前の相対位置を据え置く（画面座標を使う呼び出し側には影響しない）
      setValueHint((prev) => {
        const offsetXPx = session.handle.isConnected
          ? (e.clientX - session.handle.getBoundingClientRect().left) / session.scale
          : prev?.offsetXPx ?? 0;
        return { value: nextValue, offsetXPx, clientX: e.clientX, clientY: e.clientY };
      });
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
    // 掴んだ直後（遊びの中）に消えた場合もあるので、セッションの有無に関わらず先に外す。
    // 外し忘れると誰も掴んでいないのにロックが残り、以降まったく掴めなくなる
    releaseLock();
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
    // 先に掴んでいるドラッグがあれば2本目は掴ませない（先着優先・round2 P2-1）。
    // ここで通知を出さないのは、これが「操作の行き止まり」ではなく
    // 2本目の指が滑り込んだ一瞬の競合であり、先に掴んでいる操作は継続中のため
    // （通知を出すと引いている最中に吹き出しが割り込んで邪魔になる）。
    // 利用者から見れば「片手で引いている間、もう一方は反応しない」だけで済む
    const sharedLock = lockRef.current;
    if (sharedLock && sharedLock.ownerToken !== null) return;
    if (sharedLock) sharedLock.ownerToken = ownTokenRef.current;
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
