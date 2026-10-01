import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return (
    <PhasePlaceholder
      title="Discover events"
      phase={4}
      icon={CalendarDays}
      description="Browse what's on near you."
      features={[
        "Search by name, artist or venue",
        "Filter by city, date, category and price (ZMW / USDC)",
        "Lightweight cards with lazy-loaded posters for slow networks",
      ]}
    />
  );
}
