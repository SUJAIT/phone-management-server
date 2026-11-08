import { Response } from "express";
import { isValidObjectId } from "mongoose";
import Phone from "../models/Phone";
import ShopPayment from "../models/ShopPayment";
import User from "../models/User";
import { AuthRequest } from "../middleware/auth";
import { buildStatement } from "../utils/paymentStatement";
import { unpaidForOwner } from "./shopPaymentController";

// Only the fields needed to compute what the shop owes. Cost fields stay on the server:
// they are used for the calculation but are NEVER returned to the client.
const PHONE_FIELDS =
  "name imei soldPrice soldAt status buyingPrice transportCost serviceCost issueFixCost personalProfit createdAt updatedAt";

/**
 * GET /api/shop-payments/statement?view=unpaid|paid|statement&page=1&limit=25[&ownerId=...]
 *  - owner role: always their OWN data (ownerId is ignored, so one reseller can't read another's).
 *  - shop role: ownerId is required and must be a reseller.
 * READ-ONLY. Does not change any existing total.
 */
export async function getPaymentStatement(req: AuthRequest, res: Response) {
  try {
    let ownerId: string;
    if (req.user!.role === "owner") {
      ownerId = req.user!.id;
    } else {
      ownerId = String(req.query.ownerId || "");
      if (!isValidObjectId(ownerId)) return res.status(400).json({ message: "ownerId is required" });
      const owner = await User.findById(ownerId).select("role name");
      if (!owner || owner.role !== "owner") return res.status(404).json({ message: "Reseller not found" });
    }

    const view = ["unpaid", "paid", "statement"].includes(String(req.query.view)) ? String(req.query.view) : "unpaid";
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));

    const [soldPhones, payments] = await Promise.all([
      Phone.find({ owner: ownerId, status: "sold" }).select(PHONE_FIELDS).lean(),
      ShopPayment.find({ owner: ownerId }).select("amount note createdAt").lean(),
    ]);

    const st = buildStatement(soldPhones as any[], payments as any[]);

    // Cross-check against the exact function the dashboard cards use.
    const dash = await unpaidForOwner(ownerId);
    const matchesDashboard =
      Math.abs(dash.unpaid - st.totals.unpaid) < 0.01 &&
      Math.abs(dash.totalOwed - st.totals.totalOwed) < 0.01 &&
      Math.abs(dash.totalPaid - st.totals.totalPaid) < 0.01;

    // Unpaid: oldest first (that's the order they get cleared). Paid / statement: newest first.
    let source: any[];
    if (view === "unpaid") source = st.unpaidList;
    else if (view === "paid") source = [...st.paidList].reverse();
    else source = [...st.entries].reverse();

    const total = source.length;
    const items = source.slice((page - 1) * limit, page * limit);

    res.set("Cache-Control", "no-store");
    res.json({
      view,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      items,
      totals: st.totals,
      counts: st.counts,
      reconciled: st.reconciled && matchesDashboard,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Could not load statement" });
  }
}
