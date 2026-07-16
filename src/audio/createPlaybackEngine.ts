import type { PlaybackEngine } from './PlaybackEngine';
import { SimpleAudioEngine } from './SimpleAudioEngine';
import { SoundFontEngine, resolveSoundFontName } from './SoundFontEngine';
import type { PlaybackSoundRuntimeSettings } from './playbackSettings';

/**
 * UI 設定に応じて、実際に使う再生エンジンを作る。
 * plugin はまだ将来拡張なので、今は安全側として内蔵音源へフォールバックする。
 */
export function createPlaybackEngine(
  settings: PlaybackSoundRuntimeSettings
): PlaybackEngine {
  const engine = settings.engineMode === 'soundfont'
    ? new SoundFontEngine(resolveSoundFontName(settings.pluginName))
    : new SimpleAudioEngine();

  // 生成直後にも現在のスウィング設定を反映しておく。
  // こうしないと、エンジンを作り直した直後の初回再生だけ
  // ストレートに戻ってしまう瞬間ができてしまう。
  engine.setSwingEnabled(settings.swingEnabled);

  return engine;
}
