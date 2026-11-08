"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentStatement = getPaymentStatement;
const mongoose_1 = require("mongoose");
const Phone_1 = __importDefault(require("../models/Phone"));
const ShopPayment_1 = __importDefault(require("../models/ShopPayment"));
const User_1 = __importDefault(require("../models/User"));
const paymentStatement_1 = require("../utils/paymentStatement");
const shopPaymentController_1 = require("./shopPaymentController");
// Only the fields needed to compute what the shop owes. Cost fields stay on the server:
// they are used for the calculation but are NEVER returned to the client.
const PHONE_FIELDS = "name imei soldPrice soldAt status buyingPrice transportCost serviceCost issueFixCost personalProfit createdAt updatedAt";
/**
 * GET /api/shop-payments/statement?view=unpaid|paid|statement&page=1&limit=25[&ownerId=...]
 *  - owner role: always their OWN data (ownerId is ignored, so one reseller can't read another's).
 *  - shop role: ownerId is required and must be a reseller.
 * READ-ONLY. Does not change any existing total.
 */
async function getPaymentStatement(req, res) {
    try {
        let ownerId;
        if (req.user.role === "owner") {
            ownerId = req.user.id;
        }
        else {
            ownerId = String(req.query.ownerId || "");
            if (!(0, mongoose_1.isValidObjectId)(ownerId))
                return res.status(400).json({ message: "ownerId is required" });
            const owner = await User_1.default.findById(ownerId).select("role name");
            if (!owner || owner.role !== "owner")
                return res.status(404).json({ message: "Reseller not found" });
        }
        const view = ["unpaid", "paid", "statement"].includes(String(req.query.view)) ? String(req.query.view) : "unpaid";
        const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));
        const [soldPhones, payments] = await Promise.all([
            Phone_1.default.find({ owner: ownerId, status: "sold" }).select(PHONE_FIELDS).lean(),
            ShopPayment_1.default.find({ owner: ownerId }).select("amount note createdAt").lean(),
        ]);
        const st = (0, paymentStatement_1.buildStatement)(soldPhones, payments);
        // Cross-check against the exact function the dashboard cards use.
        const dash = await (0, shopPaymentController_1.unpaidForOwner)(ownerId);
        const matchesDashboard = Math.abs(dash.unpaid - st.totals.unpaid) < 0.01 &&
            Math.abs(dash.totalOwed - st.totals.totalOwed) < 0.01 &&
            Math.abs(dash.totalPaid - st.totals.totalPaid) < 0.01;
        // Unpaid: oldest first (that's the order they get cleared). Paid / statement: newest first.
        let source;
        if (view === "unpaid")
            source = st.unpaidList;
        else if (view === "paid")
            source = [...st.paidList].reverse();
        else
            source = [...st.entries].reverse();
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
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ message: "Could not load statement" });
    }
}
