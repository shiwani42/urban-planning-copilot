import type { Metadata } from "next";
import "./globals.css";
import { WebMcpProvider } from "@/components/WebMcpProvider";
import { KeepalivePing } from "@/components/KeepalivePing";

export const metadata: Metadata = {
  title: "Urban Planning Copilot",
  description: "AI-native urban planning workspace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body className="antialiased min-h-screen">
        <WebMcpProvider>
          <KeepalivePing />
          {children}
        </WebMcpProvider>
      </body>
    </html>
  );
}
