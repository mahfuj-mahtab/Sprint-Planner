import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  strategyOverview,
  strategyProfileUpdate,
  pillarCreate,
  pillarUpdate,
  pillarDelete,
  goalCreate,
  goalUpdate,
  goalKeyResultUpdate,
  goalDelete,
  kpiCreate,
  kpiUpdate,
  kpiDelete,
  kpiEntryCreate,
  kpiEntriesList,
  reviewUpsert,
  reviewList,
  reviewDelete,
} from "../controllers/strategy.controllers.js";

const router = Router({ mergeParams: true });

router.get("/overview", authenticateToken, strategyOverview);
router.patch("/profile", authenticateToken, strategyProfileUpdate);

router.post("/pillars", authenticateToken, pillarCreate);
router.patch("/pillars/:pillarId", authenticateToken, pillarUpdate);
router.delete("/pillars/:pillarId", authenticateToken, pillarDelete);

router.post("/goals", authenticateToken, goalCreate);
router.patch("/goals/:goalId", authenticateToken, goalUpdate);
router.patch("/goals/:goalId/key-results", authenticateToken, goalKeyResultUpdate);
router.delete("/goals/:goalId", authenticateToken, goalDelete);

router.post("/kpis", authenticateToken, kpiCreate);
router.patch("/kpis/:kpiId", authenticateToken, kpiUpdate);
router.delete("/kpis/:kpiId", authenticateToken, kpiDelete);
router.get("/kpis/:kpiId/entries", authenticateToken, kpiEntriesList);
router.post("/kpis/:kpiId/entries", authenticateToken, kpiEntryCreate);

router.get("/reviews", authenticateToken, reviewList);
router.put("/reviews", authenticateToken, reviewUpsert);
router.delete("/reviews/:reviewId", authenticateToken, reviewDelete);

export default router;
