import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { stellarConfig } from "@/lib/stellar/config";
import { customerNav, staffNav } from "./nav-items";

export function SiteHeader() {
  return (
    <header className="bg-background/85 sticky top-0 z-40 border-b backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" aria-label="BY Tickets home">
          <Logo />
        </Link>
        {stellarConfig.isTestnet && (
          <Badge variant="outline" className="border-sun/50 text-sun">
            Testnet
          </Badge>
        )}
        <nav className="ml-auto hidden items-center gap-1 text-sm md:flex">
          {[...customerNav.slice(1), ...staffNav].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-3 py-2 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
