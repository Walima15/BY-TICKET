import Link from "next/link";
import { BadgeCheck, Gift, ScanLine, ShieldCheck, Ticket, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const pillars = [
  { word: "Buy.", text: "Pay in USDC or XLM, see prices in Kwacha.", icon: Ticket, color: "text-sun" },
  { word: "Attend.", text: "Rotating QR tickets that can't be screenshotted.", icon: ScanLine, color: "text-copper" },
  { word: "Earn.", text: "BY Points on every ticket and every check-in.", icon: Gift, color: "text-emerald" },
  { word: "Connect.", text: "Proof-of-attendance badges for real fans.", icon: Users, color: "text-hibiscus" },
];

const trust = [
  { icon: ShieldCheck, text: "No oversold shows — capacity is enforced on-chain." },
  { icon: BadgeCheck, text: "Resale caps set by organizers stop scalpers." },
  { icon: ScanLine, text: "Scanners keep working when the network drops." },
];

export default function HomePage() {
  return (
    <div>
      <section className="bg-chitenge relative overflow-hidden border-b">
        <div className="mx-auto max-w-6xl px-4 py-14 md:py-24">
          <p className="text-muted-foreground mb-4 text-sm font-semibold tracking-widest uppercase">
            Lusaka · Kitwe · Ndola · Livingstone · and beyond
          </p>
          <h1 className="font-heading max-w-3xl text-5xl leading-[0.95] font-extrabold md:text-7xl">
            Tickets for the <span className="text-gradient-brand">culture</span>.
          </h1>
          <p className="text-muted-foreground mt-5 max-w-xl text-lg">
            Gigs, festivals, comedy nights, church conferences and pop-ups. Real tickets, verified on Stellar, with
            rewards every time you show up.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/events" className={cn(buttonVariants({ size: "lg" }), "h-12 px-6 text-base font-semibold")}>
              Find events
            </Link>
            <Link
              href="/organizer"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-12 px-6 text-base font-semibold")}
            >
              Sell tickets
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map(({ word, text, icon: Icon, color }) => (
          <div key={word} className="bg-card rounded-2xl border p-5">
            <Icon className={cn("mb-3 size-7", color)} aria-hidden />
            <h2 className={cn("font-heading text-2xl font-extrabold", color)}>{word}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{text}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <ul className="grid gap-3 md:grid-cols-3">
          {trust.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm">
              <Icon className="text-emerald mt-0.5 size-5 shrink-0" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
