import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Organizer" };

export default function OrganizerPage() {
  return (
    <PhasePlaceholder
      title="Organizer dashboard"
      phase={6}
      icon={LayoutDashboard}
      description="Run your events end to end."
      features={[
        "Create and edit events, ticket tiers, capacity and pricing",
        "Transfer limits and resale price caps",
        "Revenue split between organizer, artist and platform",
        "Sales analytics, attendee list and payouts",
      ]}
    />
  );
}
