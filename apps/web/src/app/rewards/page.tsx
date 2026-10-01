import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Rewards" };

export default function RewardsPage() {
  return (
    <PhasePlaceholder
      title="BY Points & badges"
      phase={7}
      icon={Gift}
      description="Earn on every ticket and every check-in."
      features={["Points balance and history", "Redeem for perks from organizers and vendors", "Proof-of-attendance badge collection"]}
    />
  );
}
