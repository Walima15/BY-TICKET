import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "My Tickets" };

export default function MyTicketsPage() {
  return (
    <PhasePlaceholder
      title="My Tickets"
      phase={5}
      icon={Ticket}
      description="Your tickets, ready at the door."
      features={[
        "Rotating signed QR code tied to your device and ownership",
        "Works offline once loaded",
        "Transfer to a friend within the organizer's rules",
      ]}
    />
  );
}
