import type { Metadata } from "next";
import { ScanLine } from "lucide-react";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Scanner" };

export default function ScannerPage() {
  return (
    <PhasePlaceholder
      title="Staff scanner"
      phase={5}
      icon={ScanLine}
      description="Fast, offline-capable entry."
      features={[
        "Camera QR scanning with instant offline signature checks",
        "Local double-entry protection, queued sync to the chain",
        "Big, glanceable accept / reject screens for busy gates",
      ]}
    />
  );
}
