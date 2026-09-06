// src/audio/mainPathAnalyserEngines.test.ts
// 診断用 Analyser の「配線」を**両方のエンジン**で固定するテスト（issue #618 round1 P2）。
//
// なぜ必要か:
// マスターゲインは停止（SoundFont の世代交代）や AudioContext の作り直しのたびに
// 新しくなる。そのたびに Analyser へ繋ぎ直さないと、以降ずっとピーク 0 が読まれ、
// 正常なタブを「壊れています」と誤報してしまう。
// 既存の音声テストの偽 context には createAnalyser が無く、枝張りの処理は素通り
// （null のまま）していたため、片方のエンジンだけ壊れても気づけなかった
// （#223 → #280 と同じ「同じ処理が2枚あり片方だけ直る」型の事故を防ぐ）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SimpleAudioEngine } from './SimpleAudioEngine';
import { SoundFontEngine } from './SoundFontEngine';

/** 接続先を記録するだけの偽ノード */
type MockNode = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  context: unknown;
};

/** createGain / createAnalyser の結果を後から見られる偽 AudioContext */
function createMockContext() {
  const gains: (MockNode & { gain: { value: number } })[] = [];
  const analysers: (MockNode & { fftSize: number })[] = [];
  const context = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: { name: 'destination' },
    resume: vi.fn(),
    close: vi.fn(),
    createGain() {
      const node = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), context };
      gains.push(node);
      return node;
    },
    createAnalyser() {
      const node = { fftSize: 0, connect: vi.fn(), disconnect: vi.fn(), context };
      analysers.push(node);
      return node;
    },
  };
  return { context: context as unknown as AudioContext, gains, analysers };
}

/** マスターゲインの生成はどちらのエンジンも private なので、テストからだけ入口を借りる */
type EngineWithOutputNode = { getOutputNode: (context: AudioContext) => AudioNode };
const outputNodeOf = (engine: SimpleAudioEngine | SoundFontEngine) =>
  engine as unknown as EngineWithOutputNode;

beforeEach(() => {
  // どちらのエンジンも UA を見て経路を分けるので、通常経路の UA にしておく
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('診断 Analyser の配線（両エンジン共通の契約・issue #618）', () => {
  it('内蔵音源: マスターゲインの出口が Analyser へ分岐し、getMainPathAnalyser で取り出せる', () => {
    const engine = new SimpleAudioEngine();
    const { context, gains, analysers } = createMockContext();

    const output = outputNodeOf(engine).getOutputNode(context);

    expect(analysers).toHaveLength(1);
    expect(engine.getMainPathAnalyser()).toBe(analysers[0]);
    // 本線（destination）と診断の枝の両方に繋がっている（枝は本線を置き換えない）
    expect(gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(gains[0].connect).toHaveBeenCalledWith(analysers[0]);
    expect(output).toBe(gains[0]);
  });

  it('内蔵音源: AudioContext を作り直したら、新しい context の Analyser へ張り直す', () => {
    const engine = new SimpleAudioEngine();
    const first = createMockContext();
    const second = createMockContext();

    outputNodeOf(engine).getOutputNode(first.context);
    outputNodeOf(engine).getOutputNode(second.context);

    // 閉じた context の Analyser は使えないので、新しい context のものへ入れ替わる
    expect(second.analysers).toHaveLength(1);
    expect(engine.getMainPathAnalyser()).toBe(second.analysers[0]);
    expect(second.gains[0].connect).toHaveBeenCalledWith(second.analysers[0]);
  });

  it('SoundFont: マスターゲインの出口が Analyser へ分岐し、getMainPathAnalyser で取り出せる', () => {
    const engine = new SoundFontEngine();
    const { context, gains, analysers } = createMockContext();

    outputNodeOf(engine).getOutputNode(context);

    expect(analysers).toHaveLength(1);
    expect(engine.getMainPathAnalyser()).toBe(analysers[0]);
    expect(gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(gains[0].connect).toHaveBeenCalledWith(analysers[0]);
  });

  it('SoundFont: 停止（出力経路の世代交代）のたびに、新しいマスターゲインから枝を張り直す', () => {
    const engine = new SoundFontEngine();
    const { context, gains, analysers } = createMockContext();

    outputNodeOf(engine).getOutputNode(context);
    // 停止は旧マスターゲインを切り離して捨てる（尻尾を消すための世代交代）。
    // このあと張り直さないと、以降ずっとピーク 0 が読まれて誤報になる
    engine.stopAll();
    outputNodeOf(engine).getOutputNode(context);

    expect(gains).toHaveLength(2);
    // context が同じあいだは Analyser を作り直さない（#622 のノード増加を避ける）
    expect(analysers).toHaveLength(1);
    expect(gains[1].connect).toHaveBeenCalledWith(analysers[0]);
    expect(engine.getMainPathAnalyser()).toBe(analysers[0]);
  });

  it('createAnalyser が使えない環境でも、本線の配線は変わらない（診断できないだけ）', () => {
    const engine = new SimpleAudioEngine();
    const { context, gains } = createMockContext();
    // 古いブラウザ・テスト用モックの再現
    (context as unknown as { createAnalyser: unknown }).createAnalyser = () => {
      throw new Error('createAnalyser is not supported');
    };

    const output = outputNodeOf(engine).getOutputNode(context);

    expect(engine.getMainPathAnalyser()).toBeNull();
    expect(gains[0].connect).toHaveBeenCalledWith(context.destination);
    expect(output).toBe(gains[0]);
  });
});
