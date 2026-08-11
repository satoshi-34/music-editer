// src/components/ConfirmDialog.tsx
// アプリ内の確認ダイアログ（Issue #221）。
// これまで `window.confirm` を使っていたが、埋め込みブラウザ（CDP 制御下のブラウザ・
// 一部の WebView・キオスク環境）では confirm のダイアログが表示されず常に false が
// 返るため、押しても何も起きない「無反応」になっていた。React で描くダイアログに
// 置き換えることで、どの実行環境でも同じように確認できるようにする。
// 設計の正本: .claude/specs/score-new-document/design.md

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogProps {
  /** 確認したい内容の本文（window.confirm に渡していた文言をそのまま使う） */
  message: string;
  /** ダイアログ自体の説明（スクリーンリーダー向け。既定は「確認」） */
  ariaLabel?: string;
  /** 実行ボタンの文言 */
  confirmLabel?: string;
  /** 取りやめボタンの文言 */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  message,
  ariaLabel = '確認',
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  // 決着済みフラグ。Enter キーとボタンのクリックが同じ操作で二重に走っても
  // （新規作成のような取り消せない処理が2回実行されないよう）1回しか通さない。
  const settledRef = useRef(false);

  // 開いた直後は OK ボタンへフォーカスを移す。window.confirm と同じく
  // 「開く → Enter で決定」がキーボードだけで完結するようにするため。
  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  const settle = (action: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    action();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // 譜面側のキー操作（Delete での削除など）へ伝わらないよう、ここで止める
      e.stopPropagation();
      settle(onCancel);
      return;
    }
    if (e.key === 'Enter') {
      // 「フォーカス中のボタンを Enter で押す」というブラウザ標準の挙動に頼らず、
      // ここで明示的に決定する。埋め込みブラウザ（この Issue の発端になった環境）では
      // 標準の押下が起きないことがあるため。preventDefault で標準の押下を止め、
      // それでもクリックが飛んだ場合は settle が二重実行を防ぐ。
      e.preventDefault();
      e.stopPropagation();
      settle(onConfirm);
    }
  };

  // ツールバーは overflow や transform（ページ拡縮）の中にあり、その中で描くと
  // ダイアログが切れたり位置がずれたりする。パート編集ウィンドウと同じく
  // document.body 直下へ portal して、常に画面の中央へ重ねる。
  return createPortal(
    <div
      className="confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-testid="confirm-dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="confirm-dialog">
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => settle(onCancel)}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog-ok"
            ref={confirmButtonRef}
            onClick={() => settle(onConfirm)}
            data-testid="confirm-dialog-ok"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
