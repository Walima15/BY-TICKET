import { Ticket } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  return (
    <PhasePlaceholder
      title={`Event ${id}`}
      phase={4}
      icon={Ticket}
      description="Event details and checkout."
      features={[
        "Line-up, venue, ticket tiers and remaining capacity",
        "Buy with Freighter or sign in with email (custodial wallet)",
        "Transfer and resale rules shown before purchase",
      ]}
    />
  );
}
