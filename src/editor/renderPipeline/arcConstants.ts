// src/editor/renderPipeline/arcConstants.ts
// 弧（タイ／スラー）の当たり判定とハンドルの寸法（#695 段6a で PianoSystemCanvas から物理移設）。
// 値・コメントは移設前のまま。
// 弧（タイ／スラー）の当たり判定まわりの寸法。どちらも「画面上の見た目の px」で決め、
// 実際に使うときは getRawPerScreenPx(svg) で SVG 内部座標（raw 単位）へ変換する。
// raw 単位の定数のままだと、画面表示のズームを変えたときに「画面上の掴みやすさ」が
// 倍率ぶんズレてしまう（音符側の keySelectXPad と同じ理由・同じ流儀）。
export const ARC_HIT_STROKE_SCREEN_PX = 10;
// 掴み代の下限。中央 50% だけを当たり判定にすると、全長 15〜20px の短いタイでは
// 掴める長さが 7〜10px しか残らず、実質つまめなくなるため下限を設ける。
export const ARC_HIT_MIN_LEN_SCREEN_PX = 28;
// 頂点ハンドル（正方形）の一辺。端点ハンドル（r=5 の丸）と同じく raw 単位なので、
// 譜面の拡大縮小に合わせて大きさが変わる。
export const ARC_APEX_HANDLE_SIZE = 9;
