import type { PropsWithChildren } from "react";
// これだけでOK（react-dom ではない）

type ScorePageProps = {
  pageNumber?: number;
  title?: string;
  subtitle?: string;
  credits?: { composer?: string; lyricist?: string; arranger?: string };
};

export default function ScorePage({
  children, pageNumber, title, subtitle, credits
}: PropsWithChildren<ScorePageProps>) {
  return (
    <div style={pageWrap}>
      <div style={pageStyle}>
        {/* ヘッダ（タイトル/サブタイトル） */}
        {(title || subtitle) && (
          <div style={headerStyle}>
            <div>
              {title && <div style={titleStyle}>{title}</div>}
              {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
            </div>
            {/* 右上クレジット */}
            {credits && (
              <div style={creditBox}>
                {credits.lyricist && <div>作詞 {credits.lyricist}</div>}
                {credits.composer && <div>作曲 {credits.composer}</div>}
                {credits.arranger && <div>編曲 {credits.arranger}</div>}
              </div>
            )}
          </div>
        )}

        {/* 紙の本文領域（マージン内） */}
        <div style={contentBox}>{children}</div>

        {/* ページ番号 */}
        {pageNumber != null && (
          <div style={pageNum}>{pageNumber}</div>
        )}
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  display: "flex", justifyContent: "center", padding: "40px",
  background: "#f5f7fb", minHeight: "100vh"
};

// A4縦っぽい比率（pxでOK。紙色＋ごく薄いテクスチャ）
const pageStyle: React.CSSProperties = {
  width: 840, height: 1188,  // だいたいA4比
  background: "linear-gradient(0deg,#f8f3e6 0%, #fbf8ee 100%)",
  boxShadow: "0 12px 40px rgba(0,0,0,.12)",
  border: "1px solid #e7dec8",
  position: "relative",
  fontFamily: '"Noto Serif JP", "Times New Roman", serif',
  color: "#222"
};

const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between",
  alignItems: "flex-start",
  padding: "56px 64px 0 64px"
};

const titleStyle: React.CSSProperties = {
  fontSize: 36, letterSpacing: 2, marginBottom: 6
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 18, opacity: .8
};

const creditBox: React.CSSProperties = {
  textAlign: "right", lineHeight: 1.6, fontSize: 14, marginTop: 6
};

const contentBox: React.CSSProperties = {
  position: "absolute", left: 64, right: 64, top: 160, bottom: 72
};

const pageNum: React.CSSProperties = {
  position: "absolute", bottom: 32, left: "50%",
  transform: "translateX(-50%)", fontSize: 14, opacity: .7
};
