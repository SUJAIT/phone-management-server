/**
 * Paid / Unpaid phone statement (READ-ONLY).
 *
 * Payments are stored as lump sums (ShopPayment) and are not linked to individual phones, so
 * phone-level status is DERIVED the way a bank statement clears debts: every sold phone is a
 * debit (what the shop owes), every payment is a credit, and credits are applied to the
 * OLDEST sold phones first (FIFO).
 *
 * This file never writes anything and never changes how totals are calculated:
 *   totalOwed = sum(amountOwedByShop)   totalPaid = sum(payments)   unpaid = max(0, owed - paid)
 * These are the SAME formulas as unpaidForOwner(), and the result carries a `reconciled` check
 * so any mismatch with the dashboard number is visible instead of silent.
 */
import { amountOwedByShop } from "./calc";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type PhoneState = "paid" | "partial" | "unpaid";

export interface StatementPhone {
  _id: string;
  name: string;
  imei: string;
  soldAt: Date;
  soldPrice: number;
  owed: number; // what the shop owes the reseller for this phone
  paidAmount: number; // part of `owed` already covered by payments (oldest-first)
  unpaidAmount: number; // part still unpaid
  state: PhoneState;
}

export interface StatementEntry {
  type: "phone" | "payment";
  id: string;
  date: Date;
  description: string;
  // Present only on type "phone" rows (id = the phone id) so the UI can open its details.
  name?: string;
  imei?: string;
  state?: PhoneState;
  owed?: number;
  paidAmount?: number;
  unpaidAmount?: number;
  debit: number; // shop owes more (phone sold)
  credit: number; // shop paid
  balance: number; // running balance after this entry (unpaid so far)
}

export function buildStatement(
  soldPhones: any[],
  payments: { _id: any; amount: number; note?: string; createdAt: Date }[]
) {
  // 1) debits: sold phones that actually carry an owed amount, oldest first
  const phones = soldPhones
    .map((p) => ({
      raw: p,
      owed: round2(amountOwedByShop(p)),
      at: new Date(p.soldAt || p.updatedAt || p.createdAt),
    }))
    .filter((x) => x.owed > 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || String(a.raw._id).localeCompare(String(b.raw._id)));

  const totalOwed = round2(phones.reduce((s, x) => s + x.owed, 0));
  const totalPaid = round2(payments.reduce((s, x) => s + (x.amount || 0), 0));

  // 2) FIFO: apply the total credit to the oldest phones first
  let credit = totalPaid;
  const list: StatementPhone[] = phones.map((x) => {
    const applied = round2(Math.min(x.owed, Math.max(0, credit)));
    credit = round2(credit - applied);
    const unpaidAmount = round2(x.owed - applied);
    return {
      _id: String(x.raw._id),
      name: x.raw.name,
      imei: x.raw.imei || "",
      soldAt: x.at,
      soldPrice: x.raw.soldPrice,
      owed: x.owed,
      paidAmount: applied,
      unpaidAmount,
      state: unpaidAmount === 0 ? "paid" : applied === 0 ? "unpaid" : "partial",
    };
  });
  const surplus = round2(Math.max(0, credit)); // payments beyond everything owed (should be 0)

  // 3) bank-statement entries, oldest -> newest (phone before payment on identical timestamps)
  const events = [
    ...list.map((p) => ({
      type: "phone" as const,
      id: p._id,
      date: p.soldAt,
      description: `${p.name} sold`,
      name: p.name,
      imei: p.imei,
      state: p.state,
      owed: p.owed,
      paidAmount: p.paidAmount,
      unpaidAmount: p.unpaidAmount,
      debit: p.owed,
      credit: 0,
    })),
    ...payments.map((pay) => ({
      type: "payment" as const,
      id: String(pay._id),
      date: new Date(pay.createdAt),
      description: pay.note ? `Payment received — ${pay.note}` : "Payment received",
      debit: 0,
      credit: round2(pay.amount || 0),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.type === "phone" ? -1 : 1) - (b.type === "phone" ? -1 : 1));

  let running = 0;
  const entries: StatementEntry[] = events.map((e) => {
    running = round2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });

  const unpaid = round2(Math.max(0, totalOwed - totalPaid));
  const unpaidList = list.filter((p) => p.state !== "paid");
  const paidList = list.filter((p) => p.state === "paid");

  return {
    totals: { totalOwed, totalPaid, unpaid, surplus },
    counts: {
      paid: paidList.length,
      unpaid: unpaidList.length, // includes the one partly-paid phone, if any
      partial: list.filter((p) => p.state === "partial").length,
      entries: entries.length,
    },
    // Sum of the phone-level unpaid amounts MUST equal the dashboard's unpaid figure.
    reconciled: Math.abs(round2(list.reduce((s, p) => s + p.unpaidAmount, 0)) - unpaid) < 0.01,
    unpaidList,
    paidList,
    entries,
  };
}
