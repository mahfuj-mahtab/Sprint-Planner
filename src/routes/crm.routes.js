import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  crmDashboard,
  crmOverview,
  clientList,
  clientCreate,
  clientGet,
  clientUpdate,
  clientDelete,
  clientAddLog,
  clientDeleteLog,
  clientSnoozeFollowUp,
  clientPortalInvite,
  clientPortalRevoke,
} from "../controllers/crm.controllers.js";

const router = Router({ mergeParams: true });

router.get("/dashboard", authenticateToken, crmDashboard);
router.get("/overview", authenticateToken, crmOverview);
router.get("/", authenticateToken, clientList);
router.post("/", authenticateToken, clientCreate);
router.get("/:clientId", authenticateToken, clientGet);
router.patch("/:clientId", authenticateToken, clientUpdate);
router.delete("/:clientId", authenticateToken, clientDelete);
router.post("/:clientId/logs", authenticateToken, clientAddLog);
router.delete("/:clientId/logs/:logId", authenticateToken, clientDeleteLog);
router.post("/:clientId/follow-up/snooze", authenticateToken, clientSnoozeFollowUp);
router.post("/:clientId/portal-invite", authenticateToken, clientPortalInvite);
router.delete("/:clientId/portal-access/:userId", authenticateToken, clientPortalRevoke);

export default router;
