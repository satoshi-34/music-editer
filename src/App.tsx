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
//
// ホーム表示中の譜面画面は「見えないが生きている」ため、2重の遮断を入れる（round1 P1）:
//  - ラッパーの inert: フォーカス移動（Tab）・クリック・支援技術からの到達を止める
//  - setHomeShown フラグ: window / document 級のキーボードショートカット
//    （削除・貼り付け・Undo 等）を各リスナーの入口で無視させる（inert は
//    フォーカスが body にあるときの window リスナーまでは止められないため）

import { useCallback, useEffect, useRef, useState } from 'react';
import ScorePage, { type HomeActionResult, type ScorePageHomeActions } from './components/ScorePage';
import HomeScreen, { type HomeOpenKind, type HomeResumeInfo } from './components/HomeScreen';
import type { ScoreType, WorkSummary } from './types/storage';
import type { ToolbarTab } from './utils/editorContextLabels';
import { getLastOpenedWorkId, hasStoredData, listWorks } from './utils/storage';
import { getOmrApiUrl } from './utils/omrApi';
import { APP_VERSION } from './utils/appVersion';
import { setHomeShown } from './utils/homeVisibility';
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
  // 操作口が入る前にホームのボタンが押された場合の持ち越し（round1 P2）。
  // 捨てると「押したのに何も起きない」無言の失敗になる（#318）。
  // 複数押された場合も順に実行するため配列で持つ（round2 P2: 単一スロットだと上書きで消える）
  const pendingActionsRef = useRef<Array<(actions: ScorePageHomeActions) => Promise<void>>>([]);
  // 実行中ガード（round2 P2）: 新規作成などを連打すると saveCurrentWork / startNewWork が
  // 並行実行され、重複作品や別作品への上書きが起きる。実行中の追加操作は無視する
  const actionRunningRef = useRef(false);
  // 失敗の理由はホーム側に表示する（round2 P2: 通知系は inert な譜面画面の下で
  // 視覚・支援技術の双方に届かない）
  const [homeError, setHomeError] = useState<string | null>(null);
  // 一覧・前回の続きはホームを開くたびに読み直す（編集して戻ってきたとき、
  // 最終更新日時やタイトルが古いままだと「保存されていない」と誤解させるため）
  const [snapshot, setSnapshot] = useState(() => readHomeSnapshot());
  const [availableOpenKinds, setAvailableOpenKinds] = useState<HomeOpenKind[]>(() => resolveAvailableOpenKinds());

  // キーボードショートカットの共有フラグを表示状態と同期する（round1 P1）。
  // effect は描画後に走るため、切替の瞬間の取りこぼしを避けるべく、切替関数側でも
  // 同期的に set している（round2 P3）。この effect は StrictMode の再実行や
  // アンマウント時の後始末を含めた「最終的な整合」の担保
  useEffect(() => {
    setHomeShown(showHome);
    return () => setHomeShown(false);
  }, [showHome]);

  const goHome = useCallback(() => {
    // ホームへ戻る瞬間からショートカットを止める（round2 P3: effect 任せだと
    // 描画までの一瞬、譜面側のリスナーが生きている）
    setHomeShown(true);
    setSnapshot(readHomeSnapshot());
    setAvailableOpenKinds(resolveAvailableOpenKinds());
    setHomeError(null);
    setShowHome(true);
  }, []);

  /**
   * 譜面画面側で旧データの移行・起動時の復元が済んだとき（round1 P2）。
   * App の初期スナップショットは移行**前**に読んでいるため、単一作品時代からの
   * 移行ユーザーではここで読み直さないと「前回の続き」「保存した作品」が空のままになる
   */
  const handleLibraryReady = useCallback(() => {
    setSnapshot(readHomeSnapshot());
    setAvailableOpenKinds(resolveAvailableOpenKinds());
    // 操作口の登録前に押されたボタンがあれば、ここで順に実行する（round1/round2 P2）。
    // 登録は復元と同じ初回レンダー直後なので、体感は「一瞬遅れて反応した」程度に収まる
    const pending = pendingActionsRef.current;
    if (pending.length > 0 && homeActionsRef.current) {
      pendingActionsRef.current = [];
      const actions = homeActionsRef.current;
      void (async () => {
        for (const run of pending) await run(actions);
      })();
    }
  }, []);

  /**
   * ホームのボタンから譜面画面の処理を呼ぶ。処理が成功したときだけ譜面画面へ移る
   * （round1 P1: 保存失敗などで中断されたのにホームだけ閉じると、通知も文脈も失う）。
   * 操作口が未登録なら持ち越して、登録直後（handleLibraryReady）に実行する。
   */
  const runOnScorePage = useCallback((action: (actions: ScorePageHomeActions) => HomeActionResult | Promise<HomeActionResult>) => {
    const run = async (actions: ScorePageHomeActions) => {
      // 実行中の連打は無視する（round2 P2: 新規作成の並行実行で重複作品が生まれる）
      if (actionRunningRef.current) return;
      actionRunningRef.current = true;
      try {
        setHomeError(null);
        const result = await action(actions);
        if (result.ok) {
          // 画面が切り替わる瞬間からショートカットを許可する（round2 P3）
          setHomeShown(false);
          setShowHome(false);
        } else {
          // 失敗時はホームに留まり、理由をホーム側に表示する（round2 P2）
          setHomeError(result.message);
        }
      } finally {
        actionRunningRef.current = false;
      }
    };
    const actions = homeActionsRef.current;
    if (actions) {
      void run(actions);
    } else {
      pendingActionsRef.current.push((late) => run(late));
    }
  }, []);

  const handleResume = useCallback(() => {
    setHomeShown(false);
    setShowHome(false);
  }, []);
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
      {/* inert: ホーム表示中は譜面画面をフォーカス・クリック・支援技術から切り離す
          （round1 P1）。React 19 は inert を boolean 属性として扱える */}
      <div inert={showHome} data-testid="score-page-holder">
        <ScorePage homeActionsRef={homeActionsRef} onGoHome={goHome} onLibraryReady={handleLibraryReady} />
      </div>
      {showHome && (
        <HomeScreen
          appVersion={APP_VERSION}
          resume={snapshot.resume}
          works={snapshot.works}
          availableOpenKinds={availableOpenKinds}
          errorMessage={homeError}
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
