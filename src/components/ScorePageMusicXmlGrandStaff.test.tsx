// MusicXML の1パート大譜表（<staves>2）読込の ScorePage 配線テスト（#419・Codex round1 P1）。
//
// musicXmlGrandStaff.test.ts はパーサー単体しか見ないため、ScorePage が
// 「どのパートを右手・左手に載せるか」の選び方（旧実装は clef だけで選び、
// 両段ト音の正当な大譜表で片手が消える）を検出できない。ここでは実ファイル選択
// （input[type=file] への change）から右手・左手の SVG 表示までを固定する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import ScorePage from './ScorePage';
import {
  createSavedScoreData, createWork, saveWorkAutosaveData, setLastOpenedWorkId, loadWorkAutosaveData,
} from '../utils/storage';
import { SCORE_EDIT_NOTICE_EVENT, type ScoreEditNoticeDetail } from '../utils/scoreEditorNotices';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });
Object.defineProperty(window, 'print', { value: vi.fn() });
class ResizeObserverMock { observe() {} unobserve() {} disconnect() {} }
// @ts-expect-error jsdom 環境にはグローバル定義が無いため補う
window.ResizeObserver = ResizeObserverMock;

const MOUNT_HEAVY_TIMEOUT_MS = 60000;

let workId = '';

/** 読込先の作品を種まきする（空ストレージだと作品IDが無く、自動保存の行き先を検証できない） */
function seedEmptyWork() {
  const rest = [{ dur: '1' as const, isRest: true, keys: ['b/4'] }];
  const data = createSavedScoreData(
    { title: '読込前', subtitle: '', lyricist: '', composer: '', arranger: '' },
    [{ partId: 'melody', clef: 'treble', measures: [{ events: rest, voices: [{ id: 'voice-1', events: rest }] }] }],
    1, 1, 'single'
  );
  const created = createWork('読込前');
  if (!created.success || !created.data) throw new Error('createWork failed');
  saveWorkAutosaveData(created.data.id, data);
  setLastOpenedWorkId(created.data.id);
  workId = created.data.id;
}


/** 1パート×2五線のピアノ大譜表 MusicXML（Finale / MuseScore / OMR の主流形式）。
 *  上段: c5 全音符（voice 1）・下段: c3 全音符（voice 5。五線をまたぐ通し番号の慣習を再現） */
function grandStaffXml(opts?: { staff1Clef?: string }): string {
  const clef1 = opts?.staff1Clef ?? 'G';
  const clef1Line = clef1 === 'G' ? 2 : 4;
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>${clef1}</sign><line>${clef1Line}</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff>
      </note>
      <backup><duration>16</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>16</duration><voice>5</voice><type>whole</type><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;
}

async function importXml(xml: string) {
  // 隠しファイル入力は「ファイル」タブの中にしか描画されない
  fireEvent.click(screen.getByRole('tab', { name: 'ファイル' }));
  const file = new File([xml], 'grand.musicxml', { type: 'application/xml' });
  const input = document.querySelector('input[type="file"][accept^=".xml,.musicxml"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ScorePage: MusicXML 大譜表（<staves>2）の読込配線（#419）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorageMock.clear();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get: () => 900, configurable: true });
  });

  afterEach(() => {
    cleanup();
    if (clientWidthSpy) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    vi.restoreAllMocks();
  });

  it('1パート2五線がピアノ譜として右手・左手へ分かれて表示・保存される', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    await importXml(grandStaffXml());

    // レイヤーチップ（ピアノ譜のみ表示）が出る＝ピアノ譜として取り込まれた
    await waitFor(() => {
      expect(document.body.textContent).toContain('右手・声部1');
    }, { timeout: 15000 });

    // SVG に両段ぶんの音符が実際に描かれている（保存だけ通って描画へ渡らない退行の検出）
    await waitFor(() => {
      expect(document.querySelectorAll('g.vf-stavenote').length).toBeGreaterThanOrEqual(2);
    }, { timeout: 15000 });

    // 自動保存データで右手=c/5・左手=c/3 を確認（表示の実体）
    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      expect(parts?.length).toBe(2);
      const right = parts?.find((p) => p.partId === 'right-hand');
      const left = parts?.find((p) => p.partId === 'left-hand');
      expect(right?.measures?.[0]?.events?.[0]?.keys?.[0]).toBe('c/5');
      expect(left?.measures?.[0]?.events?.[0]?.keys?.[0]).toBe('c/3');
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // 旧実装（clef だけで両手を選ぶ）だと、両段ともト音の正当な大譜表で
  // 2段目が読み捨てられる（Codex round1 P1）。partId 優先の選択を固定する
  it('両段ともト音記号の大譜表でも、2段目が左手として残る（クレフ正規化は通知される）', async () => {
    const notices: string[] = [];
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
      if (detail?.message) notices.push(detail.message);
    };
    window.addEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    // 2段目もト音で書かれた大譜表（高音域どうしのピアノ曲で実在する形）
    const xml = grandStaffXml().replace(
      '<clef number="2"><sign>F</sign><line>4</line></clef>',
      '<clef number="2"><sign>G</sign><line>2</line></clef>',
    );
    await importXml(xml);

    await waitFor(() => {
      const parts = loadWorkAutosaveData(workId).data?.parts;
      const left = parts?.find((p) => p.partId === 'left-hand');
      // 肝は「2段目が読み捨てられない」こと。保存データのクレフはアプリの
      // ピアノモデル（左手=bass固定）に正規化されるため、ここでは断言しない
      expect(left?.measures?.[0]?.events?.[0]?.keys?.[0]).toBe('c/3');
    }, { timeout: 15000 });
    // 見た目のクレフが黙って変わらない: 正規化の通知が**画面に**出ている（#318）。
    // イベント収集だけでなく、通知UI（data-testid=edit-notice）の表示まで固定する
    await waitFor(() => {
      const noticeEl = document.querySelector('[data-testid="edit-notice"]');
      expect(noticeEl?.textContent ?? '').toContain('クレフ');
    }, { timeout: 15000 });
    expect(notices.some((n) => n.includes('クレフ') && n.includes('標準'))).toBe(true);
    window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, listener);
  }, MOUNT_HEAVY_TIMEOUT_MS);

  // クロススタッフ連符（PR #475）: 実音と置換休符で連符 id が割れると描画側が
  // 連符と認識せず（同一 id が numNotes 個連続の条件）、g.vf-tuplet が出ない。
  // 読込→両段の描画までを実マウントで固定する
  it('連符が五線をまたぐ大譜表でも、両段に連符（vf-tuplet）が描画される', async () => {
    seedEmptyWork();
    render(<ScorePage />);
    await waitFor(() => {
      expect(document.querySelector('rect.vf-note-hit')).toBeTruthy();
    }, { timeout: 15000 });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>12</divisions><staves>2</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>1</voice><type>eighth</type>
        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>2</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>36</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    await importXml(xml);

    await waitFor(() => {
      expect(document.body.textContent).toContain('右手・声部1');
      // 上段（実音1+置換休符2）と下段（置換休符1+実音2）の両方で連符括りが描かれる
      expect(document.querySelectorAll('g.vf-tuplet').length).toBeGreaterThanOrEqual(2);
    }, { timeout: 15000 });
  }, MOUNT_HEAVY_TIMEOUT_MS);
});
