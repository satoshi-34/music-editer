// src/components/HomeScreen.tsx
// ホーム画面（Issue #500）。「前回の続き」「新しく作る（譜種選択）」「開く」
// 「保存した作品」「設定」を1枚にまとめた玄関。
// 設計の正本: .claude/specs/home-screen/design.md
//
// この画面は表示専用（プレゼンテーショナル）にしてある。実際の処理（作品の切替・
// ファイルを開く・設定タブを開く）はすべて譜面画面（ScorePage）側の既存処理を
// 呼び出す形にして、同じ機能を2か所へ書かないようにしている。

import type { ScoreType, WorkSummary } from '../types/storage';
import { SCORE_TYPE_BUTTONS, TOOLBAR_TAB_BUTTONS, type ToolbarTab } from '../utils/editorContextLabels';
import { formatWorkTitle, formatWorkUpdatedAt } from '../utils/workDisplay';
import { formatAppVersion } from '../utils/appVersion';

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

/** 「前回の続き」に出す作品の情報（無ければ null） */
export interface HomeResumeInfo {
  workId: string;
  title: string;
  updatedAt: number;
}

export interface HomeScreenProps {
  /** 表示するアプリのバージョン（`v` は付けない生の値。例: `3.6.0`） */
  appVersion: string;
  /** 前回開いていた作品（自動保存済みの作業）。まだ何も無ければ null */
  resume: HomeResumeInfo | null;
  /** 保存されている作品の一覧（更新の新しい順で渡される想定） */
  works: WorkSummary[];
  /** 「前回の続き」を開く（＝譜面画面へ戻るだけ。読み込みは起動時に済んでいる） */
  onResume: () => void;
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
}

export default function HomeScreen({
  appVersion,
  resume,
  works,
  onResume,
  onSelectWork,
  onCreateNew,
  onOpen,
  availableOpenKinds,
  onOpenSettings,
}: HomeScreenProps) {
  const openButtons = OPEN_BUTTONS.filter(button => availableOpenKinds.includes(button.kind));

  return (
    <div className="home-screen" role="main" aria-label="ホーム" data-testid="home-screen">
      <div className="home-inner">
        <header className="home-header">
          <h1 className="home-title">楽譜エディタ</h1>
          {/* 将来ログイン／アカウントのボタンを置く枠（Issue #500）。
              いまは何も置かない（お試しの障壁を上げないため、ログインは作らない方針）。
              場所だけ確保しておくことで、後から足しても並びが崩れない。 */}
          <div className="home-header-slot" aria-hidden="true" />
        </header>

        {/* 1. 前回の続き。起動直後に最短で編集へ戻れるよう最上段へ置く */}
        <section className="home-section home-resume-section" aria-labelledby="home-resume-heading">
          <h2 id="home-resume-heading" className="home-section-title">前回の続き</h2>
          {resume ? (
            <>
              <button
                type="button"
                className="home-primary-button"
                onClick={onResume}
                data-testid="home-resume"
              >
                <span className="home-primary-button-label">前回の続きを開く</span>
                <span className="home-primary-button-sub">
                  {formatWorkTitle(resume.title)}
                  <span className="home-updated-at">（最終更新 {formatWorkUpdatedAt(resume.updatedAt)}）</span>
                </span>
              </button>
              {/* 「勝手に消えていないか」という不安に先回りして、保存の状態を明示する
                  （#318「行き止まりは喋る」と同じ趣旨で、黙って済ませない） */}
              <p className="home-note">編集内容はこの端末のブラウザへ自動保存されています。</p>
            </>
          ) : (
            <p className="home-note" data-testid="home-resume-empty">
              まだ保存された作業がありません。下の「新しく作る」から譜面の種類を選んで始めてください。
            </p>
          )}
        </section>

        {/* 2. 新規作成（譜種選択） */}
        <section className="home-section" aria-labelledby="home-new-heading">
          <h2 id="home-new-heading" className="home-section-title">新しく作る</h2>
          <div className="home-card-grid">
            {SCORE_TYPE_BUTTONS.map(type => (
              <button
                key={type.id}
                type="button"
                className="home-card-button"
                onClick={() => onCreateNew(type.id)}
                title={type.description}
                data-testid={`home-new-${type.id}`}
              >
                <span className="home-card-label">{type.label}</span>
                <span className="home-card-description">{type.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 3. ファイルから開く。譜面画面のファイルタブと同じ導線をそのまま呼ぶ */}
        <section className="home-section" aria-labelledby="home-open-heading">
          <h2 id="home-open-heading" className="home-section-title">ファイルを開く</h2>
          <div className="home-button-row">
            {openButtons.map(button => (
              <button
                key={button.kind}
                type="button"
                className="home-secondary-button"
                onClick={() => onOpen(button.kind)}
                title={button.description}
                data-testid={`home-open-${button.kind}`}
              >
                {button.label}
              </button>
            ))}
          </div>
        </section>

        {/* 4. 保存した作品の一覧。選ぶとその作品を開く（切替は譜面画面側の既存処理） */}
        <section className="home-section" aria-labelledby="home-works-heading">
          <h2 id="home-works-heading" className="home-section-title">保存した作品</h2>
          {works.length > 0 ? (
            <ul className="home-work-list">
              {works.map(work => (
                <li key={work.id}>
                  <button
                    type="button"
                    className="home-work-button"
                    onClick={() => onSelectWork(work.id)}
                    data-testid={`home-work-${work.id}`}
                  >
                    <span className="home-work-title">{formatWorkTitle(work.title)}</span>
                    <span className="home-updated-at">{formatWorkUpdatedAt(work.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-note">保存された作品はまだありません。</p>
          )}
        </section>

        {/* 5. 設定。譜面画面のタブを開くだけなので、設定そのものは二重に持たない */}
        <section className="home-section" aria-labelledby="home-settings-heading">
          <h2 id="home-settings-heading" className="home-section-title">設定</h2>
          <div className="home-button-row">
            {SETTINGS_TABS.map(entry => {
              const label = TOOLBAR_TAB_BUTTONS.find(tab => tab.id === entry.tab)?.label ?? entry.tab;
              return (
                <button
                  key={entry.tab}
                  type="button"
                  className="home-secondary-button"
                  onClick={() => onOpenSettings(entry.tab)}
                  title={entry.description}
                  data-testid={`home-settings-${entry.tab}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        <footer className="home-footer">
          {/* 版番号は「自分が最新版を見ているか」をチェックする人が確かめるためのもの。
              目立たせる必要は無いが、探さずに見つかる位置（フッター左）に置く */}
          <span className="home-version" data-testid="home-version">{formatAppVersion(appVersion)}</span>
          <span className="home-footer-note">保存先はこの端末のブラウザです（サーバーへは送信されません）。</span>
        </footer>
      </div>
    </div>
  );
}
