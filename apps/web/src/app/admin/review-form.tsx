"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrganizerStatus } from "@/lib/auth/roles";
import { reviewOrganizer, type ReviewState } from "./actions";

export function ReviewForm({ organizerId, status }: { organizerId: string; status: OrganizerStatus }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewOrganizer, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organizer_id" value={organizerId} />
      <Input name="note" placeholder="Note to the organizer (required to reject)" maxLength={500} aria-label="Review note" />
      <div className="flex flex-wrap gap-2">
        {status !== "approved" && (
          <Button type="submit" name="status" value="approved" size="sm" disabled={pending}>
            Approve
          </Button>
        )}
        {status === "pending" && (
          <Button type="submit" name="status" value="rejected" size="sm" variant="outline" disabled={pending}>
            Reject
          </Button>
        )}
        {status === "approved" && (
          <Button type="submit" name="status" value="suspended" size="sm" variant="destructive" disabled={pending}>
            Suspend
          </Button>
        )}
      </div>
      {state.error && (
        <p className="text-destructive text-xs" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
