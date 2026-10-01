import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** Temporary page body for routes whose features land in a later build phase. */
export function PhasePlaceholder({
  title,
  phase,
  icon: Icon,
  description,
  features,
}: {
  title: string;
  phase: number;
  icon: LucideIcon;
  description: string;
  features: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Card className="bg-chitenge">
        <CardHeader>
          <div className="bg-primary/15 text-primary mb-2 flex size-12 items-center justify-center rounded-2xl">
            <Icon className="size-6" aria-hidden />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="font-heading text-2xl">{title}</CardTitle>
            <Badge variant="secondary">Phase {phase}</Badge>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground space-y-2 text-sm">
            {features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="bg-copper mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
