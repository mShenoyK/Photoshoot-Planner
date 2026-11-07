import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ServiceWorker } from "../components/service-worker";
export const metadata: Metadata = {
  title: "FrameCraft AI — Your next great shoot",
  description: "A thoughtful workspace for portrait photographers.",
  manifest: "/manifest.webmanifest",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorker />
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header>
          <Link className="brand" href="/dashboard">
            <span className="brand-icon">F</span> FrameCraft{" "}
            <span className="muted">AI</span>
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/dashboard">Workspace</Link>
            <Link href="/shoots/new">
              New shoot <span aria-hidden>＋</span>
            </Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer>
          Made for the moments worth planning.{" "}
          <span>FrameCraft AI · Foundation preview</span>
        </footer>
      </body>
    </html>
  );
}
