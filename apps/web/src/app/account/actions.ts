"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/session";
import { limitAction } from "@/lib/security/action-guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fieldErrors, profileSchema, type FieldErrors } from "@/lib/validation/account";

export interface ProfileState {
  ok?: boolean;
  errors?: FieldErrors;
}

export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const viewer = await requireViewer("/account");
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const limited = await limitAction("profile-update", { limit: 20, windowMs: 10 * 60_000, subject: viewer.id });
  if (limited) return { errors: { form: limited } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.display_name,
      phone: parsed.data.phone ?? null,
      city: parsed.data.city ?? null,
    })
    .eq("id", viewer.id);
  if (error) {
    console.error("profile update failed", { code: error.code });
    return { errors: { form: "Couldn't save your profile. Please try again." } };
  }
  revalidatePath("/account");
  return { ok: true };
}
