import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <PhasePlaceholder
      title="Platform admin"
      phase={6}
      icon={ShieldCheck}
      description="Keep the platform healthy."
      features={["Approve organizers", "Manage platform fees", "Platform-wide sales and attendance stats"]}
    />
  );
}
