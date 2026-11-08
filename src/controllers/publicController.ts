import { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import Phone from "../models/Phone";

/**
 * PUBLIC (no login) storefront endpoints.
 *
 * SECURITY: we never return a Phone document directly. Every response is built from an
 * explicit whitelist below, so IMEI, buying price, profit, seller/NID info, owner, customer
 * details etc. can NEVER leak to the public, even if the model gets new fields later.
 */

// Owners sometimes paste the IMEI into the free-text details; strip any 14-16 digit number.
function scrubDetails(text?: string) {
  return (text || "").replace(/\b\d{14,16}\b/g, "").replace(/imei\s*[:#-]?\s*/gi, "").trim();
}

// Only the LAST 4 characters of the IMEI are ever exposed; the full IMEI never leaves the server.
function imeiLast4(imei?: string) {
  const v = (imei || "").replace(/\s+/g, "");
  return v.length >= 4 ? v.slice(-4) : "";
}

function toPublicView(p: any) {
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
const PUBLIC_FILTER = { status: "available", hidden: false } as const;
const PUBLIC_FIELDS = "name imei ram storage details sellExpectation images createdAt";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listPublicPhones(req: Request, res: Response) {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const filter: Record<string, unknown> = { ...PUBLIC_FILTER };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    // NOTE: IMEI is intentionally NOT searchable publicly.
    filter.$or = [{ name: rx }, { details: rx }, { ram: rx }, { storage: rx }];
  }
  const phones = await Phone.find(filter).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).limit(300).lean();
  res.set("Cache-Control", "public, max-age=30");
  res.json({ phones: phones.map(toPublicView) });
}

export async function getPublicPhone(req: Request, res: Response) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(404).json({ message: "Product not found" });
  const phone = await Phone.findOne({ _id: id, ...PUBLIC_FILTER }).select(PUBLIC_FIELDS).lean();
  if (!phone) return res.status(404).json({ message: "Product not found or already sold" });
  res.set("Cache-Control", "public, max-age=30");
  res.json({ phone: toPublicView(phone) });
}
