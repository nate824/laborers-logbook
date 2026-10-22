import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { dispatchEventWriteSchema, fundReportWriteSchema, unionProfileSchema } from "@shared/schema";
import { DEFAULT_UNION_PROFILE } from "@shared/union";

// Union features: the member's profile, what the trust fund shows for their
// hours (to cross-check against the log), and their out-of-work list history.
// Every row is owned by the session user; there is no cross-user access.
export function registerUnionRoutes(app: Express, requireAuth: RequestHandler) {
  const badRequest = (res: any, error: z.ZodError, what: string) =>
    res.status(400).json({ message: `Invalid ${what}`, errors: error.errors });

  app.get("/api/union/profile", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ ...DEFAULT_UNION_PROFILE, ...(user.unionProfile ?? {}) });
  });

  app.put("/api/union/profile", requireAuth, async (req, res) => {
    try {
      const profile = unionProfileSchema.parse(req.body);
      const user = await storage.setUnionProfile(req.session.userId!, profile);
      res.json(user.unionProfile);
    } catch (error) {
      if (error instanceof z.ZodError) return badRequest(res, error, "profile");
      console.error("Union profile error:", error);
      res.status(500).json({ message: "Error saving profile" });
    }
  });

  app.get("/api/union/fund-reports", requireAuth, async (req, res) => {
    res.json(await storage.getFundReports(req.session.userId!));
  });

  app.post("/api/union/fund-reports", requireAuth, async (req, res) => {
    try {
      const data = fundReportWriteSchema.parse(req.body);
      const row = await storage.createFundReport({ ...data, note: data.note ?? null, userId: req.session.userId! });
      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return badRequest(res, error, "fund report");
      console.error("Fund report error:", error);
      res.status(500).json({ message: "Error saving fund report" });
    }
  });

  app.delete("/api/union/fund-reports/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteFundReport(req.session.userId!, id);
    res.status(ok ? 200 : 404).json({ message: ok ? "Deleted" : "Not found" });
  });

  app.get("/api/union/dispatch", requireAuth, async (req, res) => {
    res.json(await storage.getDispatchEvents(req.session.userId!));
  });

  app.post("/api/union/dispatch", requireAuth, async (req, res) => {
    try {
      const data = dispatchEventWriteSchema.parse(req.body);
      const row = await storage.createDispatchEvent({
        ...data,
        employer: data.employer ?? null,
        note: data.note ?? null,
        userId: req.session.userId!,
      });
      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return badRequest(res, error, "list event");
      console.error("Dispatch event error:", error);
      res.status(500).json({ message: "Error saving list event" });
    }
  });

  app.delete("/api/union/dispatch/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteDispatchEvent(req.session.userId!, id);
    res.status(ok ? 200 : 404).json({ message: ok ? "Deleted" : "Not found" });
  });
}
