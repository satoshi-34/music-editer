// src/components/LayoutNumberInput.tsx
// レイアウトタブの数値入力欄（Issue #578）。
//
// もともとレイアウトタブの調整はスライダー9個だったが、(a) いまいくつなのか読み取りにくい
// (b) 狙った値に止めにくい (c) 譜面上のドラッグ調整（#571 / #572）と役割が重なる、という
// 理由で数値入力へ置き換えた。直感的な調整はドラッグが担い、正確な指定はこの欄が担う。
//
// 9か所へ同じ作法を書き写すと、片方だけ直したときに食い違う（#223 → #280 と同じ壊れ方）ため、
// 入力の作法はこのコンポーネント1か所にまとめている。作法は次の4つ:
//
//   1. キーボードで打っている途中の文字は「下書き」として持つだけで、譜面には反映しない。
//      反映するのは Enter・フォーカスを外したときの確定だけ（#578 round1 P2）。
//      途中の文字も反映していた頃は、「-60」と打つ途中の「-6」や「25」と打つ途中の「2」が
//      いったん譜面に当たり、そのつど全ページの再配置と localStorage への保存が走っていた
//   2. スピナー（▲▼）と矢印キーは、押すたびに1ステップぶんを即反映する
//      （これは「打っている途中」が無い操作で、1回押す＝1つの値を選んだということ）
//   3. 確定したときに範囲外・小数なら最寄りの値へ丸めて**通知**し、数値として読めなければ
//      元の値へ戻して通知する（黙って戻すと「打ったのに効かない」行き止まりになる。
//      #318「行き止まりは喋る」）
//   4. 外側で値が変わったとき（譜面上のドラッグ調整・リセット・作品の読み込み）は、
//      入力中でなければ下書きも追従させる（ドラッグと数値欄の双方向同期）
import { useEffect, useId, useRef, useState } from 'react';

import { describeSystemLayoutValueClamped, describeSystemLayoutValueInvalid } from '../utils/scoreEditorNotices';

type Props = {
  /** アクセシブルな名前（aria-label）と通知文で使う項目名。表示ラベルと同じ文字列 */
  label: string;
  /** 現在値。表示単位のまま渡す（内部で倍率として持つ値は呼び出し側で % へ直してから渡す） */
  value: number;
  min: number;
  max: number;
  /** スピンボタン・矢印キーで1回に動く量。もとのスライダーと同じ値を渡す */
  step?: number;
  /** 欄の右に出す単位（mm / px / %）。通知文にも使う */
  unit: string;
  /** 欄の幅(px)。マイナス3桁（-60 など）が入る欄は広めにする */
  widthPx?: number;
  /** クランプ済みの値で呼ばれる。localStorage への保存などは呼び出し側で行う */
  onCommit: (value: number) => void;
  /** 行き止まりの通知（#318） */
  onNotice: (message: string) => void;
  /**
   * 欄にフォーカスが入ったとき（＝1回の編集の始まり）に呼ぶ。
   * Undo の区切りを「1回の編集＝1件」にしたい項目（音符の大きさ）で使う
   */
  onEditSessionStart?: () => void;
};

/** 生の文字列 → 数値。空文字は Number('') === 0 になってしまうため、変換前に弾く */
function parseInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export default function LayoutNumberInput({
  label, value, min, max, step = 1, unit, widthPx = 52, onCommit, onNotice, onEditSessionStart,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  // 単位（mm / px / %）の表示を欄と結ぶための id。読み上げでは名前のあとに単位が続く
  // （「段の間隔、px」）ので、欄だけを読んで単位が分からない状態にならない
  const unitId = useId();
  const [draft, setDraft] = useState(String(value));
  // スピナー（▲▼）を押している最中かどうか。マウス／指が欄の上で押されたままのときに
  // 届く変更は、キーボード入力ではなくスピナー操作だと判断するために使う
  const spinnerPressedRef = useRef(false);

  // 入力中でないときだけ外側の値へ追従する。入力中にも追従させると、
  // 打っている途中の文字が書き換わってしまう
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setDraft(String(value));
  }, [value]);

  const clampToRange = (raw: number) => Math.max(min, Math.min(max, Math.round(raw)));

  const apply = (next: number) => {
    if (next === value) return;
    onCommit(next);
  };

  /** Enter・フォーカス外しでの確定。ここだけが丸め・通知を行う */
  const commitDraft = () => {
    const parsed = parseInput(draft);
    if (parsed === null) {
      onNotice(describeSystemLayoutValueInvalid(label));
      setDraft(String(value));
      return;
    }
    const next = clampToRange(parsed);
    // 丸める前の入力値と比べる。丸めた後どうしを比べると、小数入力（14.5 → 15 など）が
    // 無通知で別の値になる（SystemLayoutPanel の直接入力と同じ判定）
    if (next !== parsed) {
      onNotice(describeSystemLayoutValueClamped(label, next, min, max, unit));
    }
    setDraft(String(next));
    apply(next);
  };

  /** 矢印キーでの1ステップ。いま欄に入っている下書きを起点にする */
  const stepBy = (direction: 1 | -1) => {
    const parsed = parseInput(draft);
    // 下書きが読めない途中状態（「-」だけなど）のときは、いまの値を起点にする
    const base = parsed === null ? value : clampToRange(parsed);
    const next = clampToRange(base + direction * step);
    setDraft(String(next));
    apply(next);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        aria-describedby={unitId}
        style={{ width: widthPx, fontSize: 13, padding: '2px 4px' }}
        onFocus={() => onEditSessionStart?.()}
        onPointerDown={() => {
          spinnerPressedRef.current = true;
          // 欄の外でボタンを離されても解除できるよう、window 側で1回だけ受ける
          window.addEventListener('pointerup', () => { spinnerPressedRef.current = false; }, { once: true });
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          // 打っている途中は反映しない（確定は Enter・フォーカス外し）。
          // 反映するのはスピナー（▲▼）を押している最中の変更だけ
          if (!spinnerPressedRef.current) return;
          const parsed = parseInput(raw);
          if (parsed === null) return;
          apply(clampToRange(parsed));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitDraft();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // ブラウザ既定のステップ操作に任せず自分で刻む。既定に任せると、
            // 届く change イベントが「打っている途中の文字」と見分けられず、
            // 矢印キーだけを即反映にできない
            e.preventDefault();
            stepBy(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
        onBlur={() => {
          spinnerPressedRef.current = false;
          commitDraft();
        }}
      />
      {/* 単位は欄の外に出す。入力欄の中に単位まで打たせると数値として読めなくなるため */}
      <span id={unitId} style={{ fontSize: 12, color: '#555' }}>{unit}</span>
    </>
  );
}
