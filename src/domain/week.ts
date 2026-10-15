import type { Slot, Speed } from "../shared/types";
import { addDays, weekday } from "./dates";

export interface MemberInfo {
  id: string;
  breakfast: boolean;
}

export interface RecurringAbsenceRow {
  user_id: string;
  weekday: number;
  slot: Slot;
}

export interface SlotPlan {
  date: string;
  slot: Slot;
  speed: Speed;
  /** chi mangia normalmente quel pasto (per la colazione: chi fa colazione) */
  eaters: string[];
  present: string[];
  absent: string[];
}

/** Default: veloce lun–ven, lunga sab–dom. */
export function defaultSpeed(date: string): Speed {
  const wd = weekday(date);
  return wd === 0 || wd === 6 ? "long" : "quick";
}

export const QUICK_MAX_MINUTES = 25;

export function eatersFor(slot: Slot, members: MemberInfo[]): string[] {
  return members.filter((m) => slot !== "breakfast" || m.breakfast).map((m) => m.id);
}

/** Colazione inclusa se almeno un membro fa colazione. */
export function slotsForDay(members: MemberInfo[]): Slot[] {
  return members.some((m) => m.breakfast) ? ["breakfast", "lunch", "dinner"] : ["lunch", "dinner"];
}

export interface PlanInput {
  startDate: string;
  members: MemberInfo[];
  recurring: RecurringAbsenceRow[];
  speeds?: Record<string, Speed>;
  days?: number;
}

/** Costruisce i 7 giorni × pasti della settimana, applicando le assenze ricorrenti. */
export function planSlots(input: PlanInput): SlotPlan[] {
  const days = input.days ?? 7;
  const out: SlotPlan[] = [];
  const slots = slotsForDay(input.members);
  for (let i = 0; i < days; i++) {
    const date = addDays(input.startDate, i);
    const wd = weekday(date);
    const speed = input.speeds?.[date] ?? defaultSpeed(date);
    for (const slot of slots) {
      const eaters = eatersFor(slot, input.members);
      const absent = eaters.filter((id) => input.recurring.some((r) => r.user_id === id && r.weekday === wd && r.slot === slot));
      out.push({ date, slot, speed, eaters, present: eaters.filter((id) => !absent.includes(id)), absent });
    }
  }
  return out;
}

/** Presenti a un pasto dati i membri e le assenze registrate. */
export function presence(slot: Slot, members: MemberInfo[], absentIds: string[]): { present: string[]; absent: string[] } {
  const eaters = eatersFor(slot, members);
  return {
    present: eaters.filter((id) => !absentIds.includes(id)),
    absent: eaters.filter((id) => absentIds.includes(id)),
  };
}
