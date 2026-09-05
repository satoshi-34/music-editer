// src/components/HomeScreen.tsx
// ホーム画面（Issue #500、レイアウトは #512 → #528 で「新規＋最近使ったファイル」中心へ再構成）。
// 中央は「新しく作る（譜種カード＋ファイルを開く）」と「最近使ったファイル」の2つのカードグリッドで、
// 「開く（種類別）」「設定」は左レールのフライアウトから辿る（中央には置かない）。
// 設計の正本: .claude/specs/home-screen/design.md
//
// この画面は表示専用（プレゼンテーショナル）にしてある。実際の処理（作品の切替・
// ファイルを開く・設定タブを開く）はすべて譜面画面（ScorePage）側の既存処理を
// 呼び出す形にして、同じ機能を2か所へ書かないようにしている。

import { useMemo, useRef, useState } from 'react';
import { getStorageCapacityState, STORAGE_FULL_MESSAGE, STORAGE_UNAVAILABLE_MESSAGE } from '../utils/storage';
import type { ScoreType, WorkSummary } from '../types/storage';
import { SCORE_TYPE_BUTTONS, TOOLBAR_TAB_BUTTONS, type ToolbarTab } from '../utils/editorContextLabels';
import { formatWorkTitle, formatWorkUpdatedAt } from '../utils/workDisplay';
import { formatAppVersion } from '../utils/appVersion';
// 保存先の文言は「初回の通知」と共通の置き場から読む（#570 仕様4: 差し替え点を1か所に）
import {
  HOME_STORAGE_LOCATION_NOTE, HOME_STORAGE_LOCATION_NOTE_SHORT, HOME_STORAGE_PORTABILITY_NOTE,
} from '../utils/storageLocationNotice';

/** ホームから呼べる「開く」導線の種類。譜面画面のファイルタブにあるものと同じ並び */
export type HomeOpenKind = 'file' | 'musicxml' | 'pdf' | 'legacy';

/** 「開く」ボタンの表示名と説明の正本（譜面画面のファイルタブと同じ言葉にそろえる） */
const OPEN_BUTTONS: ReadonlyArray<{ kind: HomeOpenKind; label: string; description: string }> = [
  { kind: 'file', label: 'ファイル (.score.json)', description: 'このアプリで書き出した譜面ファイルを開きます' },
  {
    kind: 'musicxml',
    label: 'MusicXML (.mxl)',
    description: 'MusicXML（.musicxml / .xml）と Finale 既定の圧縮形式（.mxl）を開きます',
  },
  {
    kind: 'pdf',
    label: 'PDF (β)',
    description: 'PDFの楽譜を自動で読み取って開きます（β版：読み取り結果は必ず確認・修正してください）',
  },
  { kind: 'legacy', label: '以前の手動保存', description: '旧版の「保存」で残したデータを読み込みます' },
];

/** ホームに出す設定の入口。譜面画面のタブへそのまま送るだけなので設定の実装は増えない */
const SETTINGS_TABS: ReadonlyArray<{ tab: ToolbarTab; description: string }> = [
  { tab: 'score', description: '楽譜の種類・編成・拍子・調号' },
  { tab: 'layout', description: '段組み・余白・文字の大きさなど紙面の見た目' },
  { tab: 'playback', description: '再生の速さ・音色・音量' },
];

/**
 * 左レールの項目（Issue #512）。Office 系ランチャーの「ホーム / 新規 / 開く」に相当する薄いナビ。
 * ページ内の見出しへ飛ぶだけのリンク（`<a href="#...">`）にしてあるのは、
 * ・画面の切り替え（配線）を増やさずに Office の構造だけを借りるため
 * ・実行中（busy）でも移動そのものは無害で、ボタンの一括無効化の対象にしないため
 */
const RAIL_LINKS: ReadonlyArray<{ href: string; label: string; icon: string }> = [
  { href: '#home-top', label: 'ホーム', icon: '⌂' },
  { href: '#home-new-heading', label: '新規', icon: '✚' },
  { href: '#home-recent-heading', label: '最近', icon: '🕘' },
];

/**
 * 譜種カードのサムネイル（Issue #512）。実譜面のプレビュー生成は範囲外なので、
 * 譜種ごとの「見た目の違い（何段の譜表か・括弧が付くか）」だけを伝える静的な絵にしている。
 * 段数と括弧の種類を譜種から引き当てる表。
 */
const THUMBNAIL_SHAPES: Record<ScoreType, { staves: number; bracket: 'none' | 'brace' | 'bracket' }> = {
  single: { staves: 1, bracket: 'none' },
  piano: { staves: 2, bracket: 'brace' },
  quartet: { staves: 4, bracket: 'bracket' },
  ensemble: { staves: 5, bracket: 'bracket' },
};

/** 譜種カードのサムネイル1枚を描く（装飾なので支援技術からは隠す） */
function ScoreTypeThumbnail({ type }: { type: ScoreType }) {
  const shape = THUMBNAIL_SHAPES[type];
  // 紙面（120×76）の内側に、段数ぶんの五線を上から等間隔で置く。
  // 段が増えるほど1段あたりの高さが縮むので、5本の線の間隔も一緒に詰める。
  const top = 12;
  const bottom = 66;
  const slot = (bottom - top) / shape.staves;
  const lineGap = Math.min(4, slot / 6);
  const staffTops = Array.from({ length: shape.staves }, (_, i) => top + slot * i + (slot - lineGap * 4) / 2);

  return (
    <svg className="home-card-thumb" viewBox="0 0 120 76" role="presentation" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="119" height="75" rx="3" fill="#ffffff" stroke="#dee2e6" />
      {staffTops.map(staffTop => (
        <g key={staffTop}>
          {[0, 1, 2, 3, 4].map(line => (
            <line
              key={line}
              x1="26"
              x2="108"
              y1={staffTop + lineGap * line}
              y2={staffTop + lineGap * line}
              stroke="#adb5bd"
              strokeWidth="0.8"
            />
          ))}
        </g>
      ))}
      {/* 括弧（ピアノは波括弧、複数パートは角括弧）。譜種の見分けが一目で付くようにする */}
      {shape.bracket === 'brace' && (
        <path
          d={`M20 ${staffTops[0]} q-5 ${(staffTops[staffTops.length - 1] + lineGap * 4 - staffTops[0]) / 2} 0 ${staffTops[staffTops.length - 1] + lineGap * 4 - staffTops[0]}`}
          fill="none"
          stroke="#868e96"
          strokeWidth="1.6"
        />
      )}
      {shape.bracket === 'bracket' && (
        <path
          d={`M20 ${staffTops[0]} h-4 V${staffTops[staffTops.length - 1] + lineGap * 4} h4`}
          fill="none"
          stroke="#868e96"
          strokeWidth="1.6"
        />
      )}
    </svg>
  );
}

/**
 * 「ファイルを開く」カードのサムネイル（Issue #528）。譜種カードと同じ枠・同じ比率で
 * 並べたいので、画像ファイルを増やさずに静的 SVG（開いたフォルダ＋上向きの矢印）で描く。
 */
function OpenFileThumbnail() {
  return (
    <svg className="home-card-thumb" viewBox="0 0 120 76" role="presentation" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="119" height="75" rx="3" fill="#ffffff" stroke="#dee2e6" />
      <path d="M28 24h16l5 6h43v28H28z" fill="#f1f3f5" stroke="#868e96" strokeWidth="1.4" strokeLinejoin="round" />
      {/* 「読み込む」向きが一目で分かるよう、フォルダの中へ入る矢印を重ねる */}
      <path d="M60 32v14m0 0-6-6m6 6 6-6" fill="none" stroke="#1c7c4a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface HomeScreenProps {
  /** 表示するアプリのバージョン（`v` は付けない生の値。例: `3.6.0`） */
  appVersion: string;
  /**
   * 保存されている作品の一覧。**先頭は前回開いていた作品**、残りは更新の新しい順で
   * 渡される想定（並べ替えは App.readHomeSnapshot が行う）。
   * 先頭が、以前あった「前回の続き」の役目を兼ねる（Issue #528 round1 P1）
   */
  works: WorkSummary[];
  /** 一覧から作品を選んで開く */
  onSelectWork: (workId: string) => void;
  /** 譜種を選んで新規作成する */
  onCreateNew: (type: ScoreType) => void;
  /** ファイルから開く（種類ごとに譜面画面側の既存導線を呼ぶ） */
  onOpen: (kind: HomeOpenKind) => void;
  /**
   * いま押せる「開く」導線。PDF は変換APIが用意されているときだけ、
   * 「以前の手動保存」は旧データが残っているときだけ渡される。
   * 押せない導線を並べても迷わせるだけなので、押せるものだけを出す。
   */
  availableOpenKinds: readonly HomeOpenKind[];
  /** 設定の入口（譜面画面の該当タブを開く） */
  onOpenSettings: (tab: ToolbarTab) => void;
  /**
   * 直前のホーム操作が失敗した理由（無ければ null）。譜面画面の通知はホームの下
   * （inert）に出て見えないため、失敗の説明はホーム自身が表示する（round2 P2）
   */
  errorMessage?: string | null;
  /**
   * 操作の実行中か（round3 P2）。実行中は全ボタンを無効化して連打を防ぐ
   * （無言で無視すると「押したのに反応しない」に見えるため、見た目でも止める）
   */
  busy?: boolean;
}

export default function HomeScreen({
  appVersion,
  works,
  onSelectWork,
  onCreateNew,
  onOpen,
  availableOpenKinds,
  onOpenSettings,
  errorMessage = null,
  busy = false,
}: HomeScreenProps) {
  // 保存領域の状態は、ホームを開くたび・作品の増減のたびに測り直す（削除で空いたら消える）
  const storageNotice = useMemo(() => {
    const state = getStorageCapacityState();
    if (state === 'full') return STORAGE_FULL_MESSAGE;
    if (state === 'unavailable') return STORAGE_UNAVAILABLE_MESSAGE;
    return null;
    // works が変わる＝作品の削除・作成があった、という合図として使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [works]);
  const openButtons = OPEN_BUTTONS.filter(button => availableOpenKinds.includes(button.kind));
  // レールのフライアウト（開く/設定）。中央からセクションを撤去したぶんの受け皿で、
  // 一度にどちらか1つだけ開く（運用者QA 2026-09-02）
  const [railFlyout, setRailFlyout] = useState<'open' | 'settings' | null>(null);
  const openToggleRef = useRef<HTMLButtonElement>(null);
  const settingsToggleRef = useRef<HTMLButtonElement>(null);
  /**
   * フライアウトを閉じてトグルへフォーカスを戻す（round1 P2）。
   * 実行ボタン自身が DOM から消えるため、戻さないとフォーカスが body へ落ちて
   * キーボード利用者が操作位置を見失う（失敗してホームに留まる経路で顕著）
   */
  const closeRailFlyout = (which: 'open' | 'settings') => {
    setRailFlyout(null);
    (which === 'open' ? openToggleRef : settingsToggleRef).current?.focus();
  };

  return (
    <div className="home-screen" role="main" aria-label="ホーム" aria-busy={busy} data-testid="home-screen">
      <div className="home-shell">
        {/* 左レール（Issue #512）。Office 系の起動画面と同じく、画面の骨格を左に置く。
            狭い画面では上部の横並びに変わる（CSS 側で切り替え） */}
        <aside
          className="home-rail"
          onKeyDown={(e) => {
            // トグルにフォーカスが残ったままの Escape でも閉じられるように、
            // フライアウトとトグルの**共通祖先（レール全体）**で受ける（#561 round2 P2）
            if (e.key === 'Escape' && railFlyout) closeRailFlyout(railFlyout);
          }}
        >
          <span className="home-rail-mark" aria-hidden="true">♪</span>
          <nav className="home-rail-nav" aria-label="ホーム内の移動">
            {RAIL_LINKS.map(link => (
              <a key={link.href} className="home-rail-link" href={link.href}>
                <span className="home-rail-icon" aria-hidden="true">{link.icon}</span>
                <span>{link.label}</span>
              </a>
            ))}
            {/* 「開く（種類別）」「設定」は中央から撤去し、レールのフライアウトへ（運用者QA 2026-09-02:
                「ファイルを開くが重複・設定が中央にある」。中央のカードは既定の .score.json を開く
                1枚だけ残し、種類別と設定はここから1クリックで出す） */}
            <button
              type="button"
              className={`home-rail-link home-rail-button${railFlyout === 'open' ? ' is-active' : ''}`}
              aria-expanded={railFlyout === 'open'}
              aria-controls="home-rail-flyout-open"
              data-testid="home-rail-open"
              ref={openToggleRef}
              onClick={() => setRailFlyout(prev => (prev === 'open' ? null : 'open'))}
            >
              <span className="home-rail-icon" aria-hidden="true">📂</span>
              <span>開く</span>
            </button>
            <button
              type="button"
              className={`home-rail-link home-rail-button${railFlyout === 'settings' ? ' is-active' : ''}`}
              aria-expanded={railFlyout === 'settings'}
              aria-controls="home-rail-flyout-settings"
              data-testid="home-rail-settings"
              ref={settingsToggleRef}
              onClick={() => setRailFlyout(prev => (prev === 'settings' ? null : 'settings'))}
            >
              <span className="home-rail-icon" aria-hidden="true">⚙</span>
              <span>設定</span>
            </button>
          </nav>
          {railFlyout === 'open' && (
            <div
              id="home-rail-flyout-open"
              className="home-rail-flyout"
              role="group"
              aria-label="ファイルを開く"
            >
              {openButtons.map(button => (
                <button
                  key={button.kind}
                  type="button"
                  disabled={busy}
                  className="home-secondary-button"
                  onClick={() => { closeRailFlyout('open'); onOpen(button.kind); }}
                  title={button.description}
                  data-testid={`home-open-${button.kind}`}
                >
                  {button.label}
                </button>
              ))}
            </div>
          )}
          {railFlyout === 'settings' && (
            <div
              id="home-rail-flyout-settings"
              className="home-rail-flyout"
              role="group"
              aria-label="設定"
            >
              {SETTINGS_TABS.map(entry => {
                const label = TOOLBAR_TAB_BUTTONS.find(tab => tab.id === entry.tab)?.label ?? entry.tab;
                return (
                  <button
                    key={entry.tab}
                    type="button"
                    disabled={busy}
                    className="home-secondary-button"
                    onClick={() => { closeRailFlyout('settings'); onOpenSettings(entry.tab); }}
                    title={entry.description}
                    data-testid={`home-settings-${entry.tab}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <div className="home-main">
          <header className="home-header" id="home-top">
            <h1 className="home-title">楽譜エディタ</h1>
            {/* 将来ログイン／アカウントのボタンを置く枠（Issue #500）。
                いまは何も置かない（お試しの障壁を上げないため、ログインは作らない方針）。
                場所だけ確保しておくことで、後から足しても並びが崩れない。 */}
            <div className="home-header-slot" aria-hidden="true" />
          </header>

          {/* 保存領域が満杯・使えないときの常設の案内（Issue #641 / #640）。
              満杯でも作品は消えていない（読める・消せる）ので、ここから削除・書き出しで抜け出せる */}
          {storageNotice && (
            <p className="home-error" role="alert" data-testid="home-storage-notice">
              {storageNotice}
            </p>
          )}
          {/* 直前の操作が失敗した理由（round2 P2）。role=alert で支援技術にも即時に届く */}
          {errorMessage && (
            <p className="home-error" role="alert" data-testid="home-error">
              {errorMessage}
            </p>
          )}

          {/* 1. 新しく作る（Issue #528）。譜種カード4種の右に「ファイルを開く」カードを1枚並べ、
              「作る」と「開く」という起動直後にやりたいことを1行で選べるようにする。
              グリッドは画面幅いっぱいに広がるので、広い画面でも中央に余白が残らない */}
          <section className="home-section" aria-labelledby="home-new-heading">
            <h2 id="home-new-heading" className="home-section-title">新しく作る</h2>
            <div className="home-card-grid">
              {SCORE_TYPE_BUTTONS.map(type => (
                <button
                  key={type.id}
                  type="button"
                  disabled={busy}
                  className="home-card-button"
                  onClick={() => onCreateNew(type.id)}
                  title={type.description}
                  data-testid={`home-new-${type.id}`}
                >
                  <ScoreTypeThumbnail type={type.id} />
                  <span className="home-card-label">{type.label}</span>
                  <span className="home-card-description">{type.description}</span>
                </button>
              ))}
              {/* 「開く」は使用頻度が高いので中央にも置く（Issue #528・運用者の指示）。
                  レールのフライアウト（種類別）と役割分担し、こちらは既定の .score.json を開く
                  （下段が使えない＝ファイル導線がひとつも無いときは、このカードも出さない） */}
              {openButtons.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  className="home-card-button"
                  onClick={() => onOpen(openButtons[0].kind)}
                  title={openButtons[0].description}
                  data-testid="home-new-open"
                >
                  <OpenFileThumbnail />
                  <span className="home-card-label">ファイルを開く</span>
                  <span className="home-card-description">保存済みの譜面ファイルを開きます</span>
                </button>
              )}
            </div>
          </section>

          {/* 2. 最近使ったファイル（Issue #528）。以前あった「前回の続き」の緑のバナーは廃止し、
              この一覧の先頭（＝いちばん新しく触った作品）が同じ役割を果たす。
              Issue #608 で横並びのカードから「横幅いっぱいの薄い行」の縦リストへ変えた。
              横に並べると1枚が狭く、頭が同じ作品名（「月光 第1楽章…」）が同じところで
              切り詰められて区別できなかったため、幅は名前を出すことに使う */}
          <section className="home-section" aria-labelledby="home-recent-heading">
            <h2 id="home-recent-heading" className="home-section-title">最近使ったファイル</h2>
            {works.length > 0 ? (
              <ul className="home-work-list">
                {works.map(work => (
                  <li key={work.id}>
                    <button
                      type="button"
                      disabled={busy}
                      className="home-work-button"
                      onClick={() => onSelectWork(work.id)}
                      // 行の幅に収まりきらないほど長い名前でも、カーソルを乗せれば全文を読める
                      title={formatWorkTitle(work.title)}
                      data-testid={`home-work-${work.id}`}
                    >
                      <span className="home-work-icon" aria-hidden="true">♬</span>
                      <span className="home-work-title">{formatWorkTitle(work.title)}</span>
                      <span className="home-updated-at">{formatWorkUpdatedAt(work.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              /* 作品がまだ無いときは黙って空にせず、次にやることを言葉で示す（#318 の趣旨） */
              <p className="home-note" data-testid="home-works-empty">
                まだ保存された作品がありません。上の「新しく作る」から譜面の種類を選んで始めてください。
              </p>
            )}
            {/* 「勝手に消えていないか」という不安に先回りして、保存の場所を明示する（#318・#497）。
                #570 でここを常設の保存先表示に格上げした: 初回の通知は数秒で消えるため、
                「ログインが無い＝全世界に公開されているのでは」という後から来た不安に答えられない。
                安心（端末内だけ）と、その裏返しの注意（端末を変えると持ち出せない）を対で出す */}
            <p className="home-note" data-testid="home-storage-location-note">
              {HOME_STORAGE_LOCATION_NOTE}
            </p>
            <p className="home-note" data-testid="home-storage-portability-note">
              {HOME_STORAGE_PORTABILITY_NOTE}
            </p>
          </section>


          <footer className="home-footer">
            {/* 版番号は「自分が最新版を見ているか」をチェックする人が確かめるためのもの。
                目立たせる必要は無いが、探さずに見つかる位置（フッター左）に置く */}
            <span className="home-version" data-testid="home-version">{formatAppVersion(appVersion)}</span>
            {/* フッターにも同じ事実を置く（作品一覧まで下がらずに目に入る位置）。
                文言は #570 で1か所（storageLocationNotice.ts）へ集約した。
                将来ログイン（#498）で「ローカル/クラウド」表示へ発展させるときの差し替え点 */}
            <span className="home-footer-note" data-testid="home-storage-footer-note">
              {HOME_STORAGE_LOCATION_NOTE_SHORT}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
