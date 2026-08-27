import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TraceBox",
    template: "%s · TraceBox",
  },
  description: "Trace the work. Ship with confidence.",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.accent=localStorage.getItem("tracebox-accent")||"blue"}catch(e){document.documentElement.dataset.accent="blue"}` }} /></head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="tracebox-theme">
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
