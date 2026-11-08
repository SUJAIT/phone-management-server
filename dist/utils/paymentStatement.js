"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.round2 = void 0;
exports.buildStatement = buildStatement;
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
const calc_1 = require("./calc");
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
exports.round2 = round2;
function buildStatement(soldPhones, payments) {
    // 1) debits: sold phones that actually carry an owed amount, oldest first
    const phones = soldPhones
        .map((p) => ({
        raw: p,
        owed: (0, exports.round2)((0, calc_1.amountOwedByShop)(p)),
        at: new Date(p.soldAt || p.updatedAt || p.createdAt),
    }))
        .filter((x) => x.owed > 0)
        .sort((a, b) => a.at.getTime() - b.at.getTime() || String(a.raw._id).localeCompare(String(b.raw._id)));
    const totalOwed = (0, exports.round2)(phones.reduce((s, x) => s + x.owed, 0));
    const totalPaid = (0, exports.round2)(payments.reduce((s, x) => s + (x.amount || 0), 0));
    // 2) FIFO: apply the total credit to the oldest phones first
    let credit = totalPaid;
    const list = phones.map((x) => {
        const applied = (0, exports.round2)(Math.min(x.owed, Math.max(0, credit)));
        credit = (0, exports.round2)(credit - applied);
        const unpaidAmount = (0, exports.round2)(x.owed - applied);
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
    const surplus = (0, exports.round2)(Math.max(0, credit)); // payments beyond everything owed (should be 0)
    // 3) bank-statement entries, oldest -> newest (phone before payment on identical timestamps)
    const events = [
        ...list.map((p) => ({
            type: "phone",
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
            type: "payment",
            id: String(pay._id),
            date: new Date(pay.createdAt),
            description: pay.note ? `Payment received — ${pay.note}` : "Payment received",
            debit: 0,
            credit: (0, exports.round2)(pay.amount || 0),
        })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.type === "phone" ? -1 : 1) - (b.type === "phone" ? -1 : 1));
    let running = 0;
    const entries = events.map((e) => {
        running = (0, exports.round2)(running + e.debit - e.credit);
        return { ...e, balance: running };
    });
    const unpaid = (0, exports.round2)(Math.max(0, totalOwed - totalPaid));
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
        reconciled: Math.abs((0, exports.round2)(list.reduce((s, p) => s + p.unpaidAmount, 0)) - unpaid) < 0.01,
        unpaidList,
        paidList,
        entries,
    };
}
