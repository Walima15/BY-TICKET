"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fieldErrors, organizerApplicationSchema, type FieldErrors } from "@/lib/validation/account";

export interface ApplicationState {
  ok?: boolean;
  errors?: FieldErrors;
}

/** Create the application, or update + resubmit it after a rejection. */
export async function submitOrganizerApplication(
  _prev: ApplicationState,
  formData: FormData,
): Promise<ApplicationState> {
  const viewer = await requireViewer("/organizer");
  const parsed = organizerApplicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const limited = await limitAction("organizer-apply", { limit: 10, windowMs: 60 * 60_000, subject: viewer.id });
  if (limited) return { errors: { form: limited } };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.rpc("my_organizer").maybeSingle();
  const fields = {
    name: parsed.data.name,
    slug: parsed.data.slug,
    bio: parsed.data.bio ?? null,
    city: parsed.data.city,
    contact_email: parsed.data.contact_email,
    contact_phone: parsed.data.contact_phone,
    payout_public_key: parsed.data.payout_public_key ?? null,
  };

  if (!existing) {
    const { error } = await supabase.from("organizers").insert({ user_id: viewer.id, ...fields });
    if (error) return { errors: dbErrors(error) };
  } else if (existing.status === "rejected") {
    const { error } = await supabase.from("organizers").update(fields).eq("id", existing.id);
    if (error) return { errors: dbErrors(error) };
    const { error: resubmitError } = await supabase.rpc("resubmit_organizer");
    if (resubmitError) return { errors: dbErrors(resubmitError) };
  } else {
    return { errors: { form: "Your application has already been submitted." } };
  }

  revalidatePath("/organizer");
  return { ok: true };
}

function dbErrors(error: { code?: string; message: string }): FieldErrors {
  if (error.code === "23505") return { slug: "That page address is taken. Try another name or address." };
  console.error("organizer application failed", { code: error.code });
  return { form: "Couldn't save your application. Please try again." };
}
