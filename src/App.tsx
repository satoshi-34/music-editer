// src/App.tsx
// ホーム画面（Issue #500）と譜面画面の切り替え。
// 設計の正本: .claude/specs/home-screen/design.md
//
// 譜面画面（ScorePage）は起動時からずっとマウントしたままにして、ホームは
// その上に重ねて表示する。こうしている理由:
//  - 「前回の続き」を1クリックで開けるようにするため。起動時の復元は裏で
//    済んでいるので、ホームを閉じるだけで編集を再開できる（受入条件1の
//    「起動→即編集の速さを悪化させない」）
//  - 譜面画面は表示幅を実測して初期の表示倍率を決める（#ScorePageInitialZoomFit）。
//    display:none で隠すと幅が 0 になり、倍率が狂ってしまう

import { useCallback, useRef, useState } from 'react';
import ScorePage, { type ScorePageHomeActions } from './components/ScorePage';
import HomeScreen, { type HomeOpenKind, type HomeResumeInfo } from './components/HomeScreen';
import type { ScoreType, WorkSummary } from './types/storage';
import type { ToolbarTab } from './utils/editorContextLabels';
import { getLastOpenedWorkId, hasStoredData, listWorks } from './utils/storage';
import { getOmrApiUrl } from './utils/omrApi';
import { APP_VERSION } from './utils/appVersion';
import './App.css';

/** ホームに出す一覧・前回の続きの材料を、保存データから読み直す */
function readHomeSnapshot(): { works: WorkSummary[]; resume: HomeResumeInfo | null } {
  const works = listWorks();
  // 「前回の続き」は起動時の復元先と同じ決め方にそろえる（記録が無ければ最新の作品）。
  // ここがずれると、ホームに出ている作品と実際に開かれる作品が食い違う。
  const lastOpenedId = getLastOpenedWorkId();
  const resumeWork = works.find(work => work.id === lastOpenedId) ?? works[0] ?? null;
  return {
    works,
    resume: resumeWork
      ? { workId: resumeWork.id, title: resumeWork.title, updatedAt: resumeWork.updatedAt }
      : null,
  };
}

/** いま押せる「開く」導線を決める（PDF は変換APIがあるとき、旧手動保存はデータがあるときだけ） */
function resolveAvailableOpenKinds(): HomeOpenKind[] {
  const kinds: HomeOpenKind[] = ['file', 'musicxml'];
  if (getOmrApiUrl()) kinds.push('pdf');
  if (hasStoredData()) kinds.push('legacy');
  return kinds;
}

export default function App() {
  // 起動時はホームから始める（受入条件1）。譜面画面は裏で復元を進めている
  const [showHome, setShowHome] = useState(true);
  const homeActionsRef = useRef<ScorePageHomeActions | null>(null);
  // 一覧・前回の続きはホームを開くたびに読み直す（編集して戻ってきたとき、
  // 最終更新日時やタイトルが古いままだと「保存されていない」と誤解させるため）
  const [snapshot, setSnapshot] = useState(() => readHomeSnapshot());
  const [availableOpenKinds, setAvailableOpenKinds] = useState<HomeOpenKind[]>(() => resolveAvailableOpenKinds());

  const goHome = useCallback(() => {
    setSnapshot(readHomeSnapshot());
    setAvailableOpenKinds(resolveAvailableOpenKinds());
    setShowHome(true);
  }, []);

  /** ホームのボタンから譜面画面の処理を呼び、譜面画面へ移る */
  const runOnScorePage = useCallback((action: (actions: ScorePageHomeActions) => void) => {
    const actions = homeActionsRef.current;
    // 譜面画面のマウント直後（操作口がまだ入っていない一瞬）に押された場合でも、
    // 黙って何も起きないことがないよう、画面の切り替えだけは必ず行う（#318）。
    if (actions) action(actions);
    setShowHome(false);
  }, []);

  const handleResume = useCallback(() => setShowHome(false), []);
  const handleSelectWork = useCallback((workId: string) => {
    // いま開いている作品を選んだ場合も openWork を通す（切替処理が
    // 「同じ作品なら何もしない」を含めて面倒を見る）
    runOnScorePage(actions => actions.openWork(workId));
  }, [runOnScorePage]);
  const handleCreateNew = useCallback((scoreType: ScoreType) => {
    runOnScorePage(actions => actions.createNewScore(scoreType));
  }, [runOnScorePage]);
  const handleOpen = useCallback((kind: HomeOpenKind) => {
    runOnScorePage(actions => actions.openFilePicker(kind));
  }, [runOnScorePage]);
  const handleOpenSettings = useCallback((tab: ToolbarTab) => {
    runOnScorePage(actions => actions.openSettingsTab(tab));
  }, [runOnScorePage]);

  return (
    <>
      <ScorePage homeActionsRef={homeActionsRef} onGoHome={goHome} />
      {showHome && (
        <HomeScreen
          appVersion={APP_VERSION}
          resume={snapshot.resume}
          works={snapshot.works}
          availableOpenKinds={availableOpenKinds}
          onResume={handleResume}
          onSelectWork={handleSelectWork}
          onCreateNew={handleCreateNew}
          onOpen={handleOpen}
          onOpenSettings={handleOpenSettings}
        />
      )}
    </>
  );
}
