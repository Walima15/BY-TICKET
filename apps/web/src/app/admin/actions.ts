"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reviewSchema = z.object({
  organizer_id: z.uuid(),
  status: z.enum(["approved", "rejected", "suspended"]),
  note: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(500).optional()),
});

export interface ReviewState {
  error?: string;
}

/** The database re-checks the admin role inside admin_review_organizer (defence in depth). */
export async function reviewOrganizer(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const viewer = await requireRole("admin", "/admin");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };
  if (parsed.data.status === "rejected" && !parsed.data.note) {
    return { error: "Add a note so the applicant knows what to fix." };
  }

  const limited = await limitAction("admin-review", { limit: 60, windowMs: 10 * 60_000, subject: viewer.id });
  if (limited) return { error: limited };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("admin_review_organizer", {
    p_organizer_id: parsed.data.organizer_id,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error) {
    console.error("organizer review failed", { code: error.code });
    return { error: "Couldn't save the review. Please try again." };
  }
  revalidatePath("/admin");
  return {};
}
