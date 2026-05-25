import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  clientList,
  clientCreate,
  clientGet,
  clientUpdate,
  clientDelete,
  clientAddLog,
} from "../controllers/crm.controllers.js";

const router = Router({ mergeParams: true });

router.get("/", authenticateToken, clientList);
router.post("/", authenticateToken, clientCreate);
router.get("/:clientId", authenticateToken, clientGet);
router.patch("/:clientId", authenticateToken, clientUpdate);
router.delete("/:clientId", authenticateToken, clientDelete);
router.post("/:clientId/logs", authenticateToken, clientAddLog);

export default router;
