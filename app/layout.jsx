export const metadata = { title: "Gamering", description: "Discord 组队事件" };

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body style={{ fontFamily: "system-ui", maxWidth: 720, margin: "0 auto", padding: 24 }}>{children}</body>
    </html>
  );
}
