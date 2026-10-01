"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { submitOrganizerApplication, type ApplicationState } from "./actions";

export interface ApplicationDefaults {
  name?: string | null;
  slug?: string | null;
  bio?: string | null;
  city?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  payout_public_key?: string | null;
}

export function ApplicationForm({ defaults, resubmit }: { defaults: ApplicationDefaults; resubmit?: boolean }) {
  const [state, action, pending] = useActionState<ApplicationState, FormData>(submitOrganizerApplication, {});
  const errors = state.errors ?? {};

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Organizer or brand name"
        name="name"
        defaultValue={defaults.name ?? ""}
        required
        error={errors.name}
      />
      <Field
        label="Page address"
        name="slug"
        defaultValue={defaults.slug ?? ""}
        placeholder="made from your name if empty"
        hint="Lowercase letters, numbers and dashes. Used for your public organizer page."
        error={errors.slug}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" name="city" defaultValue={defaults.city ?? ""} required error={errors.city} />
        <Field
          label="Contact phone"
          name="contact_phone"
          type="tel"
          inputMode="tel"
          placeholder="+260971234567"
          defaultValue={defaults.contact_phone ?? ""}
          required
          error={errors.contact_phone}
        />
      </div>
      <Field
        label="Contact email"
        name="contact_email"
        type="email"
        inputMode="email"
        defaultValue={defaults.contact_email ?? ""}
        required
        error={errors.contact_email}
      />
      <Field
        label="About you"
        name="bio"
        multiline
        defaultValue={defaults.bio ?? ""}
        placeholder="The events you run, venues you work with, links to past shows…"
        error={errors.bio}
      />
      <Field
        label="Payout wallet (optional)"
        name="payout_public_key"
        defaultValue={defaults.payout_public_key ?? ""}
        placeholder="G…"
        hint="A Stellar address for ticket revenue. Leave empty to use your BY Tickets wallet."
        className="font-mono text-xs"
        error={errors.payout_public_key}
      />
      {errors.form && (
        <p className="text-destructive text-sm" role="alert">
          {errors.form}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 px-6 text-base font-semibold">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {resubmit ? "Update and resubmit" : "Apply to sell tickets"}
      </Button>
    </form>
  );
}
