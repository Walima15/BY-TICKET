import { CalendarDays, Gift, House, ScanLine, Ticket } from "lucide-react";

export const customerNav = [
  { href: "/", label: "Home", icon: House },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/tickets", label: "My Tickets", icon: Ticket },
  { href: "/rewards", label: "Rewards", icon: Gift },
] as const;

export const staffNav = [
  { href: "/organizer", label: "Organizer" },
  { href: "/scan", label: "Scanner", icon: ScanLine },
  { href: "/admin", label: "Admin" },
] as const;
