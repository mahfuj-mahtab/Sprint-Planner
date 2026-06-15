import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  cmsOverview,
  cmsDashboard,
  cmsCalendar,
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
  contentRepurpose,
  contentBulkAction,
  contentAnalyticsList,
  contentAnalyticsCreate,
  contentAnalyticsDelete,
  pillarList,
  pillarCreate,
  pillarUpdate,
  pillarDelete,
  templateList,
  templateCreate,
  templateUpdate,
  templateDelete,
  goalList,
  goalCreate,
  goalUpdate,
  goalDelete,
} from "../controllers/cms.controllers.js";

const router = Router({ mergeParams: true });

/* Dashboard / overview / calendar */
router.get("/overview", authenticateToken, cmsOverview);
router.get("/dashboard", authenticateToken, cmsDashboard);
router.get("/calendar", authenticateToken, cmsCalendar);

/* Platforms */
router.post("/platforms", authenticateToken, platformCreate);
router.patch("/platforms/:platformId", authenticateToken, platformUpdate);
router.delete("/platforms/:platformId", authenticateToken, platformDelete);

/* Platform statuses (kanban columns) */
router.post("/platforms/:platformId/statuses", authenticateToken, statusCreate);
router.patch(
  "/platforms/:platformId/statuses/reorder",
  authenticateToken,
  statusReorder
);
router.patch("/statuses/:statusId", authenticateToken, statusUpdate);
router.delete("/statuses/:statusId", authenticateToken, statusDelete);

/* Content items */
router.post("/content", authenticateToken, contentCreate);
router.post("/content/bulk-action", authenticateToken, contentBulkAction);
router.patch("/content/:contentId", authenticateToken, contentUpdate);
router.post("/content/:contentId/repurpose", authenticateToken, contentRepurpose);
router.delete("/content/:contentId", authenticateToken, contentDelete);

/* Content analytics */
router.get(
  "/content/:contentId/analytics",
  authenticateToken,
  contentAnalyticsList
);
router.post(
  "/content/:contentId/analytics",
  authenticateToken,
  contentAnalyticsCreate
);
router.delete("/analytics/:analyticsId", authenticateToken, contentAnalyticsDelete);

/* Pillars (content themes per platform) */
router.get("/pillars", authenticateToken, pillarList);
router.post("/pillars", authenticateToken, pillarCreate);
router.patch("/pillars/:pillarId", authenticateToken, pillarUpdate);
router.delete("/pillars/:pillarId", authenticateToken, pillarDelete);

/* Templates */
router.get("/templates", authenticateToken, templateList);
router.post("/templates", authenticateToken, templateCreate);
router.patch("/templates/:templateId", authenticateToken, templateUpdate);
router.delete("/templates/:templateId", authenticateToken, templateDelete);

/* Goals */
router.get("/goals", authenticateToken, goalList);
router.post("/goals", authenticateToken, goalCreate);
router.patch("/goals/:goalId", authenticateToken, goalUpdate);
router.delete("/goals/:goalId", authenticateToken, goalDelete);

export default router;
