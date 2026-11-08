"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const publicController_1 = require("../controllers/publicController");
const router = (0, express_1.Router)();
// Tiny in-memory rate limiter (per IP) so the open endpoints can't be hammered.
const hits = new Map();
const WINDOW_MS = 60000;
const MAX_HITS = 120;
function rateLimit(req, res, next) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || rec.reset < now) {
        hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    }
    else if (++rec.count > MAX_HITS) {
        return res.status(429).json({ message: "Too many requests, please slow down" });
    }
    if (hits.size > 5000)
        for (const [k, v] of hits)
            if (v.reset < now)
                hits.delete(k);
    next();
}
// NO requireAuth here on purpose — this is the public storefront.
router.use(rateLimit);
router.get("/phones", publicController_1.listPublicPhones);
router.get("/phones/:id", publicController_1.getPublicPhone);
exports.default = router;
