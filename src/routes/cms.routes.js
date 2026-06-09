import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  cmsOverview,
  cmsDashboard,
  platformCreate,
  platformUpdate,
  platformDelete,
  statusCreate,
  statusUpdate,
  statusDelete,
  statusReorder,
  contentCreate,
  contentUpdate,
  contentDelete,
  contentAnalyticsList,
  contentAnalyticsCreate,
  contentAnalyticsDelete,
} from "../controllers/cms.controllers.js";

const router = Router({ mergeParams: true });

router.get("/overview", authenticateToken, cmsOverview);
router.get("/dashboard", authenticateToken, cmsDashboard);

router.post("/platforms", authenticateToken, platformCreate);
router.patch("/platforms/:platformId", authenticateToken, platformUpdate);
router.delete("/platforms/:platformId", authenticateToken, platformDelete);

router.post("/platforms/:platformId/statuses", authenticateToken, statusCreate);
router.patch("/platforms/:platformId/statuses/reorder", authenticateToken, statusReorder);
router.patch("/statuses/:statusId", authenticateToken, statusUpdate);
router.delete("/statuses/:statusId", authenticateToken, statusDelete);

router.post("/content", authenticateToken, contentCreate);
router.patch("/content/:contentId", authenticateToken, contentUpdate);
router.delete("/content/:contentId", authenticateToken, contentDelete);

router.get("/content/:contentId/analytics", authenticateToken, contentAnalyticsList);
router.post("/content/:contentId/analytics", authenticateToken, contentAnalyticsCreate);
router.delete("/analytics/:analyticsId", authenticateToken, contentAnalyticsDelete);

export default router;
