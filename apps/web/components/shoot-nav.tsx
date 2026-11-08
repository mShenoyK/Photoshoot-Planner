"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function ShootNav({ shootId }: { shootId: string }) {
  const pathname = usePathname();
  const base = `/shoots/${shootId}`;
  return (
    <nav className="shoot-nav" aria-label="Shoot workspace">
      {[
        ["", "Overview"],
        ["/subjects", "People & equipment"],
        ["/plan", "Shoot plan"],
        ["/poses", "Posing guide"],
        ["/lighting", "Lighting Lab"],
        ["/wardrobe", "Wardrobe Stylist"],
        ["/files", "Files"],
      ].map(([route, label]) => (
        <Link
          href={base + route}
          key={route}
          aria-current={pathname === base + route ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
