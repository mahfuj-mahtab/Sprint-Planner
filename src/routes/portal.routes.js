import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  portalListOrgs,
  portalOverview,
  portalProjectDetails,
  portalSprintDetails,
} from "../controllers/portal.controllers.js";

const router = Router();

router.get("/orgs", authenticateToken, portalListOrgs);
router.get("/org/:orgId/overview", authenticateToken, portalOverview);
router.get("/org/:orgId/projects/:projectId", authenticateToken, portalProjectDetails);
router.get(
  "/org/:orgId/projects/:projectId/sprints/:sprintId",
  authenticateToken,
  portalSprintDetails
);

export default router;
