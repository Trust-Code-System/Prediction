import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Prediction Platform",
  description: "Data-driven football match analysis. Not betting advice."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
          <header className="flex items-center justify-between py-5">
            <a href="/" className="text-lg font-semibold tracking-tight text-pitch-700">
              Match Analysis
            </a>
            <span className="text-xs text-slate-500">Data-driven, not betting advice</span>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
            Predictions are data-driven analysis, not guarantees and not betting advice.
          </footer>
        </div>
      </body>
    </html>
  );
}
