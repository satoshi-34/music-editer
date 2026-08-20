// 声部をまたぐクリックの約束ごと（Issue #105 → Issue #258 で仕様変更）。
//
// Issue #105（旧仕様）: 当たり判定はアクティブ声部にしか作らない。
//   下声（声部2）をアクティブにした状態で上声（声部1）の音符をクリックすると
//   声部1が編集されてしまっていたため、アクティブ声部の音符が無い小節では
//   ヒット領域を一切作らないようにして、誤編集を防いだ。
//
// Issue #258（新仕様・運用者裁定 2026-08-16）: その結果として、非アクティブ声部の
//   音符をクリックしても**無言で何も起きない**状態になっていた（実機で「右手の下声が
//   触れない」として報告）。そこで約束を次のように変更した:
//
//     選択のクリックは全声部・編集の入力はアクティブ声部だけ
//
//   非アクティブ声部の符頭をクリックしたら、その声部へ自動で切り替えて選択し、
//   切り替えたことを必ず通知する。#105 が防ぎたかった「気づかない誤編集」は、
//   「切り替えが必ず画面に出る」ことで引き継ぐ（黙って声部が変わることはない）。
//
// このテストは新しい約束を守る:
//   - アクティブ声部の**編集用**ヒット領域（.vf-note-hit）は従来どおりの範囲にしか作らない
//   - 非アクティブ声部には**選択専用**の領域（.vf-inactive-voice-note-hit）を符頭の上だけに作る
//   - 選択専用領域のクリックは声部の切り替えと通知だけを行い、譜面データを1バイトも変えない
//   - 空白（小節背景）のクリックは従来どおりアクティブ声部への入力のまま
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import PianoSystemCanvas from './PianoSystemCanvas';
import type { MeasureData } from '../types/storage';
import {
  SCORE_ACTIVE_VOICE_CHANGE_EVENT,
  SCORE_EDIT_NOTICE_EVENT,
  type ScoreActiveVoiceChangeDetail,
  type ScoreEditNoticeDetail,
} from '../utils/scoreEditorNotices';

vi.mock('../audio/NotePlayer', () => ({
  NotePlayer: vi.fn().mockImplementation(function() {
    return {
      playNoteEvent: vi.fn().mockResolvedValue(undefined),
      setSoundSource: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn()
    };
  })
}));

vi.mock('../audio/AudioEngine', () => ({
  defaultAudioEngine: {
    isInitializedState: vi.fn().mockReturnValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../audio/SoundSource', () => ({
  InstrumentType: {
    PIANO: 'piano',
    ORGAN: 'organ',
    GUITAR: 'guitar',
    STRINGS: 'strings',
  },
  SoundSource: vi.fn().mockImplementation(function() {
    return {
      getCurrentInstrument: vi.fn().mockReturnValue('piano'),
      setCurrentInstrument: vi.fn(),
      loadInstrument: vi.fn().mockResolvedValue(undefined),
      reconnectAllSynths: vi.fn(),
      dispose: vi.fn()
    };
  })
}));

const TEST_CONTAINER_WIDTH = 700;

function mockSvgLayout(svg: SVGSVGElement) {
  const width = TEST_CONTAINER_WIDTH;
  const height = parseFloat(svg.getAttribute('height') ?? '0') || 300;
  svg.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: 0, top: 0, right: width, bottom: height,
    width, height, x: 0, y: 0, toJSON: () => ({}),
  }));
  Object.defineProperty(svg, 'width', { value: { baseVal: { value: width } }, configurable: true });
  Object.defineProperty(svg, 'height', { value: { baseVal: { value: height } }, configurable: true });
}

/** 選択専用の当たり判定（非アクティブ声部の符頭）を1枚取り出す */
function inactiveVoiceHit(svg: SVGSVGElement, voiceIndex: number, noteIndex: number): SVGRectElement {
  const hit = svg.querySelector(
    `rect.vf-inactive-voice-note-hit[data-measure="0"][data-voice="${voiceIndex}"][data-note="${noteIndex}"]`
  ) as SVGRectElement;
  expect(hit).toBeTruthy();
  return hit;
}

/** その rect の中心（＝符頭の中心）を押す座標 */
function centerOf(rect: SVGRectElement): { clientX: number; clientY: number } {
  const x = parseFloat(rect.getAttribute('x')!);
  const y = parseFloat(rect.getAttribute('y')!);
  const w = parseFloat(rect.getAttribute('width')!);
  const h = parseFloat(rect.getAttribute('height')!);
  return { clientX: x + w / 2, clientY: y + h / 2 };
}

/**
 * 声部の切り替え要求と通知を拾うリスナーを貼る。
 * どちらも window の CustomEvent 方式（utils/scoreEditorNotices.ts）なので、
 * 画面（ScorePage）を描かなくても譜面側の意図をそのまま確認できる。
 */
function listenVoiceSwitch() {
  const voiceRequests: number[] = [];
  const notices: string[] = [];
  const onVoice = (e: Event) => {
    const detail = (e as CustomEvent<ScoreActiveVoiceChangeDetail>).detail;
    if (detail) voiceRequests.push(detail.voiceIndex);
  };
  const onNotice = (e: Event) => {
    const detail = (e as CustomEvent<ScoreEditNoticeDetail>).detail;
    if (detail?.message) notices.push(detail.message);
  };
  window.addEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onVoice);
  window.addEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
  return {
    voiceRequests,
    notices,
    dispose: () => {
      window.removeEventListener(SCORE_ACTIVE_VOICE_CHANGE_EVENT, onVoice);
      window.removeEventListener(SCORE_EDIT_NOTICE_EVENT, onNotice);
    },
  };
}

/** 声部1だけの小節（声部2はまだ一度も入力していない状態） */
function singleVoiceMeasure(): MeasureData[] {
  return [{
    events: [
      { dur: '4', isRest: false, keys: ['c/5'] },
      { dur: '4', isRest: false, keys: ['d/5'] },
    ],
  }];
}

/**
 * 2声部が共存する小節。
 * 声部2は五線から下へ離れた音（e/4 = ト音記号の第1線）に置き、
 * 「アクティブ声部の当たり判定と重ならない場所にある下声」を再現する。
 */
function twoVoiceMeasure(): MeasureData[] {
  return [{
    events: [
      { dur: '2', isRest: false, keys: ['c/5'] },
      { dur: '2', isRest: false, keys: ['d/5'] },
    ],
    voices: [
      {
        id: 'voice-1',
        events: [
          { dur: '2', isRest: false, keys: ['c/5'] },
          { dur: '2', isRest: false, keys: ['d/5'] },
        ],
      },
      {
        id: 'voice-2',
        stemDirection: 'down',
        events: [
          { dur: '2', isRest: false, keys: ['e/4'] },
          { dur: '2', isRest: false, keys: ['e/4'] },
        ],
      },
    ],
  }];
}

describe('PianoSystemCanvas 声部クリックのスコープ（Issue #105 → #258 で仕様変更）', () => {
  let clientWidthSpy: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientWidthSpy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      get: () => TEST_CONTAINER_WIDTH,
      configurable: true,
    });
  });

  afterEach(() => {
    if (clientWidthSpy) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthSpy);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
  });

  function renderScore(data: MeasureData[], activeVoiceIndex: 0 | 1) {
    const onChange = vi.fn();
    const view = (active: 0 | 1) => (
      <PianoSystemCanvas
        measuresPerSystem={1}
        tool={{ duration: '4', isRest: false }}
        scale={1}
        partsConfig={[{ clef: 'treble', data, onChange }]}
        showInstrumentLabels={false}
        timeSignature={[4, 4]}
        activeVoiceIndex={active}
      />
    );
    const { container, rerender } = render(view(activeVoiceIndex));
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toBeTruthy();
    mockSvgLayout(svg);
    /**
     * 実際のアプリでは、譜面が出した切り替え要求を受けて ScorePage が
     * activeVoiceIndex を変え、それが props として戻ってくる。
     * この部品単体のテストではその往復を手で再現する。
     */
    const applyActiveVoice = (active: 0 | 1) => {
      rerender(view(active));
      const nextSvg = container.querySelector('svg') as SVGSVGElement;
      mockSvgLayout(nextSvg);
      return nextSvg;
    };
    return { container, svg, onChange, applyActiveVoice };
  }

  it('声部2アクティブ・声部2未入力の小節では、声部1の編集用ヒット領域は作られない', () => {
    const { svg } = renderScore(singleVoiceMeasure(), 1);

    // 編集用（挿入・和音追加・臨時記号などが動く）領域は、従来どおりアクティブ声部にしか作らない。
    // これが無いことで、下声モードのまま上声の音符へ**編集**が入ることは決して起きない。
    const noteHits = svg.querySelectorAll('rect.vf-note-hit[data-measure="0"]');
    expect(noteHits.length).toBe(0);
  });

  it('声部2アクティブ・声部2未入力の小節でも、声部1の符頭には選択専用の領域が作られる（Issue #258）', () => {
    const { svg } = renderScore(singleVoiceMeasure(), 1);

    // 声部1の音符2つぶん（各1音）の選択専用領域がある。
    const selectHits = svg.querySelectorAll('rect.vf-inactive-voice-note-hit[data-measure="0"][data-voice="0"]');
    expect(selectHits.length).toBe(2);
  });

  it('声部2アクティブ・声部2未入力の小節で背景クリックすると、声部1ではなく声部2に新規音符が追加される', async () => {
    const data = singleVoiceMeasure();
    const { svg, onChange } = renderScore(data, 1);

    // 背景の当たり判定（小節全体）をクリックする。
    const bg = svg.querySelector('rect.vf-hit') as SVGRectElement;
    expect(bg).toBeTruthy();
    const x = parseFloat(bg.getAttribute('x')!);
    const y = parseFloat(bg.getAttribute('y')!);
    const w = parseFloat(bg.getAttribute('width')!);
    const h = parseFloat(bg.getAttribute('height')!);

    fireEvent.click(bg, { clientX: x + w / 2, clientY: y + h / 2 });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)![0] as MeasureData[];

    // 声部1（events）はクリック前とまったく同じまま（誤って編集されていない）。
    expect(updated[0].events).toEqual(data[0].events);

    // 声部2（voices[1]）が新規作成され、音符が追加されている。
    // Issue #322 以降、小節の途中をクリックするとその拍まで手前が休符で埋まるので、
    // 件数ではなく「音符はちょうど1つで、それが末尾」「手前は休符だけ」で固定する。
    const voice2 = updated[0].voices?.[1]?.events ?? [];
    expect(voice2.length).toBeGreaterThanOrEqual(1);
    expect(voice2.filter((ev) => !ev.isRest)).toHaveLength(1);
    expect(voice2.at(-1)!.isRest).toBe(false);
  });

  it('声部2アクティブのまま声部1の符頭をクリックすると、声部1へ切り替えて選択し、通知が出る（データは変えない）', async () => {
    const { container, svg, onChange, applyActiveVoice } = renderScore(singleVoiceMeasure(), 1);
    const listener = listenVoiceSwitch();

    try {
      const hit = inactiveVoiceHit(svg, 0, 0);
      fireEvent.click(hit, centerOf(hit));

      // 声部1へ切り替える要求が出る。
      expect(listener.voiceRequests).toEqual([0]);
      // 「黙って切り替わらない」ための通知。文言に切り替え先の声部が入っている。
      expect(listener.notices).toHaveLength(1);
      expect(listener.notices[0]).toContain('声部1');

      // 切り替えが反映されると、その音符が選択された状態で画面に出る（選択枠）。
      applyActiveVoice(0);
      await waitFor(() => {
        expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
      });

      // 選択しただけなので、譜面データは1バイトも変わっていない（#105 の誤編集防止を引き継ぐ）。
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      listener.dispose();
    }
  });

  it('逆方向: 声部1アクティブのまま声部2の符頭をクリックすると、声部2へ切り替えて選択する（データは変えない）', async () => {
    const { container, svg, onChange, applyActiveVoice } = renderScore(twoVoiceMeasure(), 0);
    const listener = listenVoiceSwitch();

    try {
      const hit = inactiveVoiceHit(svg, 1, 0);
      fireEvent.click(hit, centerOf(hit));

      expect(listener.voiceRequests).toEqual([1]);
      expect(listener.notices).toHaveLength(1);
      expect(listener.notices[0]).toContain('声部2');

      applyActiveVoice(1);
      await waitFor(() => {
        expect(container.querySelector('rect.vf-note-selected')).toBeTruthy();
      });
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      listener.dispose();
    }
  });

  it('単声部の譜面（声部トグルを使っていない小節）では、選択専用の領域は1枚も作られない', () => {
    // activeVoiceIndex を既定（声部1）のまま描く＝声部トグルを触っていない普通の譜面。
    // 非アクティブ声部が存在しないので、当たり判定は従来とまったく同じ姿になる。
    const { svg } = renderScore(singleVoiceMeasure(), 0);

    expect(svg.querySelectorAll('rect.vf-inactive-voice-note-hit').length).toBe(0);
    // 編集用の領域は従来どおり作られている（声部1の音符2つぶん）。
    expect(svg.querySelectorAll('rect.vf-note-hit[data-measure="0"]').length).toBeGreaterThan(0);
  });
});
