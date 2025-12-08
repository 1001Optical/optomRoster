import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const aribauGrotesk = localFont({
  src: [
    {
      path: "../../public/fonts/AribauGrotesk-Rg.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/AribauGrotesk-Bd.otf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-aribau-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Optometrist Roster Automation",
  description: "Optometrist Roster Automation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${aribauGrotesk.variable} antialiased`}
        style={{ fontFamily: 'var(--font-aribau-grotesk)' }}
      >
        {children}
      </body>
    </html>
  );
}
