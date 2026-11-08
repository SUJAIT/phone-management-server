import { Router, Request, Response, NextFunction } from "express";
import { listPublicPhones, getPublicPhone } from "../controllers/publicController";

const router = Router();

// Tiny in-memory rate limiter (per IP) so the open endpoints can't be hammered.
const hits = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_HITS = 120;
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
  } else if (++rec.count > MAX_HITS) {
    return res.status(429).json({ message: "Too many requests, please slow down" });
  }
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  next();
}

// NO requireAuth here on purpose — this is the public storefront.
router.use(rateLimit);
router.get("/phones", listPublicPhones);
router.get("/phones/:id", getPublicPhone);

export default router;
