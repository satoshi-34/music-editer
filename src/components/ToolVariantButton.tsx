// src/components/ToolVariantButton.tsx
// ─────────────────────────────────────────────────────────────
// 目的: 「代表のボタン1個 ＋ ▾（プルダウン）で変種を選ぶ」形のツールボタンを作る共通部品。
//
// なぜ共通部品にするか:
//   パレットのボタンが多すぎて第一印象を損ねている（#547 のテスト会）。対策として
//   「よく使う1個だけ並べ、仲間の記号はプルダウンへ畳む」形が運用者裁定で決まった（#548）。
//   同じ形が連符ボタン（#569・既定=3連符／2〜7連符をプルダウン）にも必要なので、
//   先に実装する側がこの部品を作り、もう一方が共用する（「同じロジックの2枚目」を作らない）。
//
// 使い方の要点:
//   - options の先頭が既定の変種。currentKey で「いまボタンに出ている変種」を指定する
//   - 本体ボタンを押すと onActivate（親側でトグルON/OFFを決める）
//   - ▾ を押すとメニューが開き、選ぶと onSelectVariant（親側で currentKey を更新して有効化する）
//   - 変種が1つだけの options では ▾ を出さない（ナチュラルのように仲間がいない記号のため）
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

/** プルダウンに並べる変種1つ分 */
export interface ToolVariantOption {
  /** 変種を一意に指す文字列（親側が currentKey と突き合わせる） */
  key: string;
  /** ボタン・メニューに出す記号や文字 */
  symbol: React.ReactNode;
  /** 支援技術・テストが掴む名前。メニュー項目と本体ボタンで同じ文言を使う */
  ariaLabel: string;
  /** マウスを乗せたときの説明 */
  title: string;
}

export default function ToolVariantButton({
  options,
  currentKey,
  active,
  onActivate,
  onSelectVariant,
  menuAriaLabel,
  buttonStyle,
  symbolStyle,
}: {
  options: ToolVariantOption[];
  currentKey: string;
  /** いまこのツールが選ばれているか（枠の色が変わる） */
  active: boolean;
  onActivate: () => void;
  onSelectVariant: (key: string) => void;
  /** ▾ ボタンの名前（例「シャープ系の種類を選ぶ」） */
  menuAriaLabel: string;
  /** パレット側の共通ボタンスタイルを渡してもらう（見た目を1か所で決めるため） */
  buttonStyle: (active: boolean, extra?: React.CSSProperties) => React.CSSProperties;
  /** 記号の字面だけに効く追加スタイル（フォント指定など） */
  symbolStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const current = options.find((option) => option.key === currentKey) ?? options[0];

  // メニューは「外側をクリックしたら閉じる」のが普通の作法。
  // React の onBlur だけだと、メニューの外にある SVG（譜面）を押したときに
  // 閉じないブラウザがあるため、開いているあいだだけ document 側でも受ける。
  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeIfOutside);
    return () => document.removeEventListener('mousedown', closeIfOutside);
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
      onKeyDown={(e) => {
        // Escape で閉じられないと、キーボードだけで使う人がメニューから抜け出せない
        if (e.key === 'Escape' && open) {
          setOpen(false);
          e.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        onClick={onActivate}
        title={current.title}
        aria-label={current.ariaLabel}
        aria-pressed={active}
        style={buttonStyle(active, {
          // ▾ を右に足すぶん、本体ボタンは少し細くして列の幅を増やさない
          width: options.length > 1 ? 28 : 36,
          borderTopRightRadius: options.length > 1 ? 0 : 6,
          borderBottomRightRadius: options.length > 1 ? 0 : 6,
          ...symbolStyle,
        })}
      >
        {current.symbol}
      </button>
      {options.length > 1 && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          title={menuAriaLabel}
          aria-label={menuAriaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          style={buttonStyle(false, {
            width: 14,
            borderLeft: 'none',
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            fontSize: 9,
            color: '#555',
          })}
        >
          ▾
        </button>
      )}
      {open && (
        <span
          // role="menu"/"menuitem" にすると項目がボタンとして探せなくなる（ARIA の role は
          // 暗黙の role を上書きするため）。並んだボタンの塊なので group で表す。
          role="group"
          aria-label={menuAriaLabel}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            display: 'flex',
            gap: 3,
            padding: 4,
            marginTop: 2,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 6,
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                onSelectVariant(option.key);
                setOpen(false);
              }}
              title={option.title}
              aria-label={option.ariaLabel}
              style={buttonStyle(option.key === currentKey, { ...symbolStyle })}
            >
              {option.symbol}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
