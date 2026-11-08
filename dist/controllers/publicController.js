"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPublicPhones = listPublicPhones;
exports.getPublicPhone = getPublicPhone;
const mongoose_1 = require("mongoose");
const Phone_1 = __importDefault(require("../models/Phone"));
/**
 * PUBLIC (no login) storefront endpoints.
 *
 * SECURITY: we never return a Phone document directly. Every response is built from an
 * explicit whitelist below, so IMEI, buying price, profit, seller/NID info, owner, customer
 * details etc. can NEVER leak to the public, even if the model gets new fields later.
 */
// Owners sometimes paste the IMEI into the free-text details; strip any 14-16 digit number.
function scrubDetails(text) {
    return (text || "").replace(/\b\d{14,16}\b/g, "").replace(/imei\s*[:#-]?\s*/gi, "").trim();
}
// Only the LAST 4 characters of the IMEI are ever exposed; the full IMEI never leaves the server.
function imeiLast4(imei) {
    const v = (imei || "").replace(/\s+/g, "");
    return v.length >= 4 ? v.slice(-4) : "";
}
function toPublicView(p) {
    return {
        _id: String(p._id),
        name: p.name,
        imeiLast4: imeiLast4(p.imei),
        ram: p.ram || "",
        storage: p.storage || "", // ROM
        details: scrubDetails(p.details),
        price: p.sellExpectation, // "Sale Expectation" is the only price customers see
        images: Array.isArray(p.images) ? p.images : [],
        createdAt: p.createdAt,
    };
}
// Same set the shop sees under "All Phone": available and not hidden.
const PUBLIC_FILTER = { status: "available", hidden: false };
const PUBLIC_FIELDS = "name imei ram storage details sellExpectation images createdAt";
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function listPublicPhones(req, res) {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    const filter = { ...PUBLIC_FILTER };
    if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        // NOTE: IMEI is intentionally NOT searchable publicly.
        filter.$or = [{ name: rx }, { details: rx }, { ram: rx }, { storage: rx }];
    }
    const phones = await Phone_1.default.find(filter).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).limit(300).lean();
    res.set("Cache-Control", "public, max-age=30");
    res.json({ phones: phones.map(toPublicView) });
}
async function getPublicPhone(req, res) {
    const { id } = req.params;
    if (!(0, mongoose_1.isValidObjectId)(id))
        return res.status(404).json({ message: "Product not found" });
    const phone = await Phone_1.default.findOne({ _id: id, ...PUBLIC_FILTER }).select(PUBLIC_FIELDS).lean();
    if (!phone)
        return res.status(404).json({ message: "Product not found or already sold" });
    res.set("Cache-Control", "public, max-age=30");
    res.json({ phone: toPublicView(phone) });
}
