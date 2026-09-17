import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "대전 오늘의 진짜 정보판",
  description: "대전의 실제 기온과 데이터 실패 상태를 정직하게 보여 주는 정보판",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
