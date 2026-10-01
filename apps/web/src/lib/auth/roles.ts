import type { Database } from "@/lib/supabase/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type OrganizerStatus = Database["public"]["Enums"]["organizer_status"];

export const ROLE_LABELS: Record<AppRole, string> = {
  customer: "Fan",
  organizer: "Organizer",
  scanner: "Scanner",
  admin: "Admin",
};
