import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Domination Daily",
  description: "DomiNations daily Web Specials dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
