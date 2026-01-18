# 要件定義書

## 概要

音楽エディターアプリケーションに音符再生機能を追加し、ユーザーが作成した譜面を音声で確認できるようにする。個別音符の再生から譜面全体の再生まで、包括的な音声フィードバック機能を提供する。

## 用語集

- **Audio_Engine**: Tone.jsベースの音声エンジン
- **Playback_Controller**: 再生制御を管理するコンポーネント
- **Note_Player**: 個別音符の再生を担当するモジュール
- **Score_Player**: 譜面全体の再生を担当するモジュール
- **Tempo_Manager**: テンポ設定と管理を行うモジュール
- **Sound_Source**: 音色（楽器音）を管理するモジュール
- **Playback_State**: 再生状態（停止/再生中/一時停止）を表す状態
- **Time_Position**: 再生位置（小節・拍単位）
- **Audio_Context**: Web Audio APIのオーディオコンテキスト

## 要件

### 要件1: 個別音符再生

**ユーザーストーリー:** 音楽制作者として、作成した個別の音符をクリックして音を確認したい。これにより、音高や音価が正しく入力されているかを即座に確認できる。

#### 受け入れ基準

1. WHEN ユーザーが譜面上の音符をクリック THEN Audio_Engine SHALL その音符の音高で音を再生する
2. WHEN 音符が休符の場合 THEN Audio_Engine SHALL 音を再生しない
3. WHEN 音符に臨時記号（#/b）が付いている場合 THEN Audio_Engine SHALL 正しい半音階で音を再生する
4. WHEN 音符の音価が指定されている場合 THEN Audio_Engine SHALL その音価に応じた長さで音を再生する
5. WHEN 複数の音符が短時間で連続クリックされた場合 THEN Audio_Engine SHALL 前の音を停止して新しい音を再生する

### 要件2: 譜面全体再生

**ユーザーストーリー:** 音楽制作者として、作成した譜面全体を通して再生したい。これにより、楽曲全体の流れやリズムを確認できる。

#### 受け入れ基準

1. WHEN ユーザーが再生ボタンを押下 THEN Score_Player SHALL 譜面の最初から順次音符を再生する
2. WHEN 再生中に小節線に到達 THEN Score_Player SHALL 正確なタイミングで次の小節に進む
3. WHEN 休符に到達 THEN Score_Player SHALL 指定された音価分の無音時間を保持する
4. WHEN 譜面の最後に到達 THEN Score_Player SHALL 再生を停止してPlayback_Stateを停止状態に変更する
5. WHEN 複数の音符が同時刻に配置されている場合 THEN Score_Player SHALL それらを同時に再生する

### 要件3: 再生制御

**ユーザーストーリー:** 音楽制作者として、再生を制御（開始/停止/一時停止）したい。これにより、必要な部分だけを確認したり、作業を中断したりできる。

#### 受け入れ基準

1. WHEN ユーザーが再生ボタンを押下 THEN Playback_Controller SHALL 再生を開始してPlayback_Stateを再生中に変更する
2. WHEN 再生中にユーザーが停止ボタンを押下 THEN Playback_Controller SHALL 再生を停止してTime_Positionを先頭にリセットする
3. WHEN 再生中にユーザーが一時停止ボタンを押下 THEN Playback_Controller SHALL 再生を一時停止してTime_Positionを保持する
4. WHEN 一時停止中にユーザーが再生ボタンを押下 THEN Playback_Controller SHALL 保存されたTime_Positionから再生を再開する
5. WHEN 再生中にユーザーが譜面を編集 THEN Playback_Controller SHALL 再生を停止して編集を許可する

### 要件4: テンポ設定

**ユーザーストーリー:** 音楽制作者として、再生テンポを調整したい。これにより、楽曲の意図したテンポで確認したり、練習用に遅いテンポで再生したりできる。

#### 受け入れ基準

1. WHEN ユーザーがテンポ値を入力 THEN Tempo_Manager SHALL その値を4分音符のBPM（Beats Per Minute）として設定する
2. WHEN テンポが60-200 BPMの範囲内 THEN Tempo_Manager SHALL 入力値を受け入れる
3. WHEN テンポが範囲外の値 THEN Tempo_Manager SHALL エラーメッセージを表示して前の値を保持する
4. WHEN 再生中にテンポが変更された場合 THEN Score_Player SHALL 新しいテンポを即座に適用する
5. WHEN テンポ設定が保存された場合 THEN Tempo_Manager SHALL 次回起動時に同じテンポを復元する

### 要件5: 音色選択

**ユーザーストーリー:** 音楽制作者として、再生時の楽器音色を選択したい。これにより、楽曲のイメージに合った音色で確認できる。

#### 受け入れ基準

1. WHEN ユーザーが音色選択メニューを開く THEN Sound_Source SHALL 利用可能な楽器音色のリストを表示する
2. WHEN ユーザーが音色を選択 THEN Sound_Source SHALL その音色を現在の再生音色として設定する
3. WHEN 音色が変更された場合 THEN Note_Player SHALL 新しい音色で個別音符を再生する
4. WHEN 音色が変更された場合 THEN Score_Player SHALL 新しい音色で譜面再生を行う
5. WHEN 音色設定が保存された場合 THEN Sound_Source SHALL 次回起動時に同じ音色を復元する

### 要件6: オーディオ初期化

**ユーザーストーリー:** システム管理者として、Web Audio APIの制約に適切に対応したい。これにより、ブラウザの自動再生ポリシーに準拠した音声機能を提供できる。

#### 受け入れ基準

1. WHEN アプリケーションが初回起動 THEN Audio_Engine SHALL ユーザーインタラクションを待機してAudio_Contextを初期化する
2. WHEN ユーザーが最初のクリック操作を実行 THEN Audio_Engine SHALL Audio_Contextを開始して音声機能を有効化する
3. WHEN Audio_Context初期化に失敗 THEN Audio_Engine SHALL エラーメッセージを表示して代替手段を提案する
4. WHEN ブラウザが音声再生をブロック THEN Audio_Engine SHALL ユーザーに許可を求めるメッセージを表示する
5. WHEN Audio_Contextが中断された場合 THEN Audio_Engine SHALL 自動的に復旧を試行する

### 要件7: 再生位置表示

**ユーザーストーリー:** 音楽制作者として、現在の再生位置を視覚的に確認したい。これにより、譜面のどの部分が再生されているかを把握できる。

#### 受け入れ基準

1. WHEN 譜面再生が開始 THEN Playback_Controller SHALL 現在再生中の音符をハイライト表示する
2. WHEN 再生位置が次の音符に移動 THEN Playback_Controller SHALL 前の音符のハイライトを解除して新しい音符をハイライトする
3. WHEN 再生が小節をまたぐ場合 THEN Playback_Controller SHALL 適切な小節の音符をハイライトする
4. WHEN 再生が停止または一時停止 THEN Playback_Controller SHALL すべてのハイライトを解除する
5. WHEN 複数ページにわたる譜面の場合 THEN Playback_Controller SHALL 必要に応じてページスクロールを実行する

### 要件8: エラーハンドリング

**ユーザーストーリー:** システム管理者として、音声関連のエラーを適切に処理したい。これにより、エラー発生時でもアプリケーションが安定して動作する。

#### 受け入れ基準

1. WHEN 音声ファイルの読み込みに失敗 THEN Audio_Engine SHALL デフォルト音色にフォールバックして継続動作する
2. WHEN Audio_Contextでエラーが発生 THEN Audio_Engine SHALL エラーログを記録してユーザーに通知する
3. WHEN メモリ不足で音声再生に失敗 THEN Audio_Engine SHALL 使用中の音声リソースを解放して再試行する
4. WHEN ネットワークエラーで音色データ取得に失敗 THEN Sound_Source SHALL キャッシュされた音色を使用する
5. WHEN 予期しないエラーが発生 THEN Audio_Engine SHALL 安全に停止してアプリケーションの他機能に影響しない

### 要件9: パフォーマンス最適化

**ユーザーストーリー:** システム管理者として、音声再生のパフォーマンスを最適化したい。これにより、大きな譜面でも滑らかな再生を実現できる。

#### 受け入れ基準

1. WHEN 長い譜面を再生 THEN Score_Player SHALL メモリ使用量を一定範囲内に制限する
2. WHEN 音色データを読み込み THEN Sound_Source SHALL 必要な音色のみを事前読み込みする
3. WHEN 再生が停止 THEN Audio_Engine SHALL 不要な音声リソースを適切に解放する
4. WHEN 複数の音符が同時再生 THEN Audio_Engine SHALL 音声処理の負荷を分散する
5. WHEN ブラウザタブが非アクティブ THEN Audio_Engine SHALL 音声処理を一時停止してCPU使用率を削減する

### 要件10: アクセシビリティ

**ユーザーストーリー:** 視覚障害のあるユーザーとして、音声機能をキーボードで操作したい。これにより、マウスを使わずに音楽制作を行える。

#### 受け入れ基準

1. WHEN ユーザーがTabキーで操作 THEN Playback_Controller SHALL 再生制御ボタンにフォーカスを移動する
2. WHEN フォーカスされた再生ボタンでSpaceキーを押下 THEN Playback_Controller SHALL 再生を開始または停止する
3. WHEN 音符が選択された状態でEnterキーを押下 THEN Note_Player SHALL その音符を再生する
4. WHEN 再生制御にフォーカス THEN Playback_Controller SHALL スクリーンリーダー用のaria-labelを提供する
5. WHEN 再生状態が変化 THEN Playback_Controller SHALL 状態変化をスクリーンリーダーに通知する