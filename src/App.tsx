// src/App.tsx
// ホーム画面（Issue #500）と譜面画面の切り替え。
// 設計の正本: .claude/specs/home-screen/design.md
//
// 譜面画面（ScorePage）は起動時からずっとマウントしたままにして、ホームは
// その上に重ねて表示する。こうしている理由:
//  - 直前まで開いていた作品を1クリックで開けるようにするため。起動時の復元は裏で
//    済んでいるので、同じ作品を選び直しても読み直しは起きない（受入条件1の
//    「起動→即編集の速さを悪化させない」）
//  - 譜面画面は表示幅を実測して初期の表示倍率を決める（#ScorePageInitialZoomFit）。
//    display:none で隠すと幅が 0 になり、倍率が狂ってしまう
//
// ホーム表示中の譜面画面は「見えないが生きている」ため、2重の遮断を入れる（round1 P1）:
//  - ラッパーの inert: フォーカス移動（Tab）・クリック・支援技術からの到達を止める
//  - setHomeShown フラグ: window / document 級のキーボードショートカット
//    （削除・貼り付け・Undo 等）を各リスナーの入口で無視させる（inert は
//    フォーカスが body にあるときの window リスナーまでは止められないため）

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ScorePage, { type HomeActionResult, type ScorePageHomeActions } from './components/ScorePage';
import HomeScreen, { type HomeOpenKind } from './components/HomeScreen';
import InstantTooltip from './components/InstantTooltip';
import type { ScoreType, WorkSummary } from './types/storage';
import type { ToolbarTab } from './utils/editorContextLabels';
import { getLastOpenedWorkId, hasStoredData, listWorks } from './utils/storage';
import { getOmrApiUrl } from './utils/omrApi';
import { APP_VERSION } from './utils/appVersion';

// 開発環境限定の定数チューニングパネル（#596）。動的 import と DEV ガードを
// 同一関数（このモジュール評価時の三項）に置き、本番バンドルへコードごと含めない
const DevTuningPanel = import.meta.env.DEV
  ? lazy(() => import('./components/DevTuningPanel'))
  : null;
import { setHomeShown } from './utils/homeVisibility';
import './App.css';

/**
 * ホームに出す「最近使ったファイル」の材料を、保存データから読み直す。
 * 並びは「前回開いていた作品を先頭」+「残りは更新の新しい順」（Issue #528 round1 P1）。
 * 更新順だけに任せると、古い作品へ切り替えて編集せずに終了した場合に
 * 「先頭 = 前回の続き」が崩れる（先頭クリックで別の作品へ切り替わってしまう）。
 * updatedAt を開くだけで書き換える案は「更新日時」表示が嘘になるため採らない。
 */
function readHomeSnapshot(): { works: WorkSummary[] } {
  const works = listWorks();
  const lastOpenedId = getLastOpenedWorkId();
  if (!lastOpenedId) return { works };
  const lastOpenedIndex = works.findIndex((w) => w.id === lastOpenedId);
  if (lastOpenedIndex <= 0) return { works };
  const reordered = [works[lastOpenedIndex], ...works.slice(0, lastOpenedIndex), ...works.slice(lastOpenedIndex + 1)];
  return { works: reordered };
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
  const [showHome, setShowHome] = useState<boolean>(() => {
    // dev チューニングの「反映（再読み込み）」直後だけホームを飛ばして譜面へ直帰する
    // （#596 運用者フィードバック:「反映を押すとホームに戻る」— 調整ループの摩擦解消）。
    // sessionStorage の一回きりフラグで、通常の起動（#528 のホーム表示）は変えない
    if (import.meta.env.DEV) {
      try {
        if (window.sessionStorage.getItem('dev-tuning-skip-home') === '1') {
          window.sessionStorage.removeItem('dev-tuning-skip-home');
          return false;
        }
      } catch { /* sessionStorage が使えない環境では通常どおりホームへ */ }
    }
    return true;
  });
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
  // busy 表示用（ref は同期判定の正本・state は描画用の写し）
  const [actionRunning, setActionRunning] = useState(false);
  // 一覧はホームを開くたびに読み直す（編集して戻ってきたとき、
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
   * 移行ユーザーではここで読み直さないと「最近使ったファイル」が空のままになる
   */
  /** 持ち越した操作を順に実行する（操作口が入っていれば） */
  const drainPendingActions = useCallback(() => {
    const pending = pendingActionsRef.current;
    if (pending.length > 0 && homeActionsRef.current) {
      pendingActionsRef.current = [];
      const actions = homeActionsRef.current;
      void (async () => {
        for (const run of pending) await run(actions);
      })();
    }
  }, []);

  const handleLibraryReady = useCallback(() => {
    setSnapshot(readHomeSnapshot());
    setAvailableOpenKinds(resolveAvailableOpenKinds());
    drainPendingActions();
  }, [drainPendingActions]);

  /**
   * 操作口（homeActionsRef）が入った合図（round3 P2）。復元データの無い初回起動では
   * onLibraryReady が登録 effect より先に走るため、そちらだけでキューを排出すると
   * 起動直後の操作が永久に残る。登録側からも排出する
   */
  const handleActionsReady = useCallback(() => {
    drainPendingActions();
  }, [drainPendingActions]);

  /**
   * ホームのボタンから譜面画面の処理を呼ぶ。処理が成功したときだけ譜面画面へ移る
   * （round1 P1: 保存失敗などで中断されたのにホームだけ閉じると、通知も文脈も失う）。
   * 操作口が未登録なら持ち越して、登録直後（handleLibraryReady）に実行する。
   */
  const runOnScorePage = useCallback((action: (actions: ScorePageHomeActions) => HomeActionResult | Promise<HomeActionResult>) => {
    const run = async (actions: ScorePageHomeActions) => {
      // 実行中の連打は無視する（round2 P2: 新規作成の並行実行で重複作品が生まれる）。
      // 実行中はホームのボタンが busy 表示で無効化されるので、無言にはならない（round3 P2）
      if (actionRunningRef.current) return;
      actionRunningRef.current = true;
      setActionRunning(true);
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
      } catch (err) {
        // 操作の途中で投げられた例外も無処理にしない（round3 P2）。
        // ホームに留まり、例外の内容ごと理由として見せる
        setHomeError(`操作を完了できませんでした: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        actionRunningRef.current = false;
        setActionRunning(false);
      }
    };
    const actions = homeActionsRef.current;
    if (actions) {
      void run(actions);
    } else {
      pendingActionsRef.current.push((late) => run(late));
    }
  }, []);

  const handleSelectWork = useCallback((workId: string) => {
    // いま開いている作品（＝一覧の先頭になることが多い「前回の続き」）を選んだ場合も
    // openWork を通す。切替処理が「同じ作品なら読み直さない」を含めて面倒を見るので、
    // 起動直後に先頭を1クリックすれば、そのまま編集へ戻れる（Issue #528 受入条件2）
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
      {/* 即時ツールチップ（#633）。data-tip を持つ要素のホバーを document で拾うので、アプリに1つだけ */}
      <InstantTooltip />
      {DevTuningPanel && (
        <Suspense fallback={null}>
          <DevTuningPanel />
        </Suspense>
      )}
      {/* inert: ホーム表示中は譜面画面をフォーカス・クリック・支援技術から切り離す
          （round1 P1）。React 19 は inert を boolean 属性として扱える */}
      <div inert={showHome} data-testid="score-page-holder">
        <ScorePage
          homeActionsRef={homeActionsRef}
          onGoHome={goHome}
          onLibraryReady={handleLibraryReady}
          onHomeActionsReady={handleActionsReady}
        />
      </div>
      {showHome && (
        <HomeScreen
          appVersion={APP_VERSION}
          works={snapshot.works}
          availableOpenKinds={availableOpenKinds}
          errorMessage={homeError}
          busy={actionRunning}
          onSelectWork={handleSelectWork}
          onCreateNew={handleCreateNew}
          onOpen={handleOpen}
          onOpenSettings={handleOpenSettings}
        />
      )}
    </>
  );
}
