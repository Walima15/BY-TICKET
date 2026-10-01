"use client";

import { useActionState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { updateProfile, type ProfileState } from "./actions";

export function ProfileForm({
  profile,
}: {
  profile: { display_name: string | null; phone: string | null; city: string | null };
}) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfile, {});
  const errors = state.errors ?? {};

  useEffect(() => {
    if (state.ok) toast.success("Profile saved");
  }, [state]);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Name"
        name="display_name"
        defaultValue={profile.display_name ?? ""}
        autoComplete="name"
        required
        error={errors.display_name}
      />
      <Field
        label="Phone (for mobile money)"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+260971234567"
        defaultValue={profile.phone ?? ""}
        error={errors.phone}
      />
      <Field
        label="City"
        name="city"
        autoComplete="address-level2"
        placeholder="Lusaka"
        defaultValue={profile.city ?? ""}
        error={errors.city}
      />
      {errors.form && (
        <p className="text-destructive text-sm" role="alert">
          {errors.form}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-10 px-5">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Save profile
      </Button>
    </form>
  );
}
