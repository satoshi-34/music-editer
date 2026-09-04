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
//   - 「いま選んでいる変種」は親が持つ（この部品は state に持たない）。タブを切り替えると
//     パレットごとアンマウントされるため、ここに置くと選択が消えるため（#569 round1 P2）
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  clampDropdownMenuLeft,
  clampDropdownMenuTop,
  estimateVariantMenuWidth,
  VARIANT_MENU_ESTIMATED_HEIGHT_PX,
  VARIANT_MENU_ITEM_GAP_PX,
  VARIANT_MENU_PADDING_PX,
} from '../utils/toolbarPlacement';

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
  // メニューは fixed で描くので、位置は「ボタンの実測位置」から毎回決める（下の updateMenuPos）
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 部品の中で押下が始まっているか。Safari はボタンの mousedown でフォーカスを外しつつ
  // blur の relatedTarget を null にする（WebKit Bug 254655）ため、null を「外へ出た」と
  // 即断すると項目クリックの click より先に閉じて選択が届かない（round3 P2）
  const pressingInsideRef = useRef(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const current = options.find((option) => option.key === currentKey) ?? options[0];

  // メニューの位置決め。`position: absolute` にすると、親の `.toolbar-panel`
  // （`overflow-x: auto`。左＝縦配置では `overflow-x: hidden`）にメニューが切られて
  // 項目の大半が見えなくなる。既存のリセットメニュー（App.css:448-452）と同じく
  // 「fixed + ボタンの実測位置 + ビューポート内クランプ」で描く（#569 round1 P1）。
  const updateMenuPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // ▾ ボタンが画面外へスクロールで消えた・折りたたみで非表示になった（矩形 0）ときは閉じる。
    // fixed のメニューはクランプで画面端に留まるため、開いたままだと ▾ の無い場所に
    // メニューだけが残って別の操作群へ重なる（round2 P2）
    // 非表示は checkVisibility で判定する（矩形 0 で判定すると、レイアウトを持たない
    // テスト環境=jsdom でも「消えた」扱いになり、開いた瞬間に閉じてしまう）。
    // 画面外の判定は矩形に大きさがあるときだけ行う
    const trigger = triggerRef.current;
    const hidden = typeof trigger?.checkVisibility === 'function' && !trigger.checkVisibility();
    const hasSize = rect.width > 0 && rect.height > 0;
    const offscreen = hasSize && (
      rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth
    );
    if (hidden || offscreen) {
      setOpen(false);
      return;
    }
    // 開いた直後は実測できないので、まず個数からの見積もりで置き、描画後に実測で置き直す
    const menuRect = menuRef.current?.getBoundingClientRect();
    const menuWidth = menuRect?.width || estimateVariantMenuWidth(options.length);
    const menuHeight = menuRect?.height || VARIANT_MENU_ESTIMATED_HEIGHT_PX;
    setMenuPos({
      top: clampDropdownMenuTop({
        anchorBottom: rect.bottom,
        viewportHeight: window.innerHeight,
        // 既定値（420px）はリセットメニュー用の大きな値。この小さな1行メニューに使うと
        // 画面下部のボタンから開いたときに不必要に上へ跳ね上がるため、自分の高さを渡す
        menuMaxHeightPx: menuHeight,
      }),
      left: clampDropdownMenuLeft({
        anchorLeft: rect.left,
        menuWidthPx: menuWidth,
        viewportWidth: window.innerWidth,
      }),
    });
  }, [options.length]);

  // 描画されたメニューの実寸で位置を確定させる（見積もりとの差を1フレームで吸収する）
  useLayoutEffect(() => {
    if (open) updateMenuPos();
  }, [open, updateMenuPos]);

  // メニューは「外側をクリックしたら閉じる」のが普通の作法。
  // React の onBlur だけだと、メニューの外にある SVG（譜面）を押したときに
  // 閉じないブラウザがあるため、開いているあいだだけ document 側でも受ける。
  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // fixed のメニューは wrapper の外（body 直下相当の位置）に描かれて見えるが、
      // DOM 上は wrapper の子のままなので contains で判定できる
      if (!wrapperRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', closeIfOutside);
    return () => document.removeEventListener('mousedown', closeIfOutside);
  }, [open]);

  // 開いているあいだにツールバーがスクロール・リサイズするとボタンが動くので位置を測り直す。
  // fixed は画面基準なので、追従させないとメニューだけが取り残される。
  useEffect(() => {
    if (!open) return;
    const onMove = () => updateMenuPos();
    window.addEventListener('resize', onMove);
    // capture で受けるのは、スクロールするのが window ではなく `.toolbar-panel` 側だから
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, updateMenuPos]);

  /** メニューを閉じて、キーボード操作の起点だった ▾ ボタンへフォーカスを戻す */
  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    // 戻さないと、閉じた瞬間にフォーカスが文書の先頭へ落ちてキーボード利用者が迷子になる
    triggerRef.current?.focus();
  }, []);

  return (
    <span
      ref={wrapperRef}
      style={{ display: 'inline-flex', flexShrink: 0 }}
      // キーボードで Tab 移動して部品の外へ出たら閉じる（round2 P2: mousedown だけだと
      // Enter/Space でツールバーを折りたたんだとき open のまま隠れ、再展開で勝手に復活する）。
      // relatedTarget が部品の中（本体ボタン・▾・項目）なら開いたままにする
      onPointerDownCapture={() => { pressingInsideRef.current = true; }}
      onMouseDownCapture={() => { pressingInsideRef.current = true; }}
      onBlur={(e) => {
        if (!open) return;
        const next = e.relatedTarget as Node | null;
        if (next) {
          if (!wrapperRef.current?.contains(next)) setOpen(false);
          return;
        }
        // relatedTarget が無いときは、部品の中で押下が始まっていれば「項目を押している最中」
        // として閉じない（click の後に外側 mousedown / 選択で閉じる）。それ以外は外へ出た
        if (!pressingInsideRef.current) setOpen(false);
      }}
      onClickCapture={() => { pressingInsideRef.current = false; }}
      onPointerUpCapture={() => { pressingInsideRef.current = false; }}
      onMouseUpCapture={() => { pressingInsideRef.current = false; }}
      onKeyDown={(e) => {
        // Escape で閉じられないと、キーボードだけで使う人がメニューから抜け出せない
        if (e.key === 'Escape' && open) {
          closeAndRefocus();
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
          ref={triggerRef}
          type="button"
          onClick={() => {
            setOpen((prev) => {
              // 開く前に位置を決めておく（レイアウト前の1フレームだけ左上に出るのを防ぐ）
              if (!prev) updateMenuPos();
              return !prev;
            });
          }}
          title={menuAriaLabel}
          aria-label={menuAriaLabel}
          // aria-haspopup="menu" は付けない。中身は role="menu" ではなく
          // 「並んだボタンの塊（group）」なので、名乗りと実体を一致させる（#569 round1 P2）
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
          ref={menuRef}
          // role="menu"/"menuitem" にすると項目がボタンとして探せなくなる（ARIA の role は
          // 暗黙の role を上書きするため）。並んだボタンの塊なので group で表す。
          role="group"
          aria-label={menuAriaLabel}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            // リセットメニュー（z-index: 1001）と同じ土俵。ツールバーより手前に出す
            zIndex: 1001,
            display: 'flex',
            gap: VARIANT_MENU_ITEM_GAP_PX,
            padding: VARIANT_MENU_PADDING_PX / 2,
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
                closeAndRefocus();
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
