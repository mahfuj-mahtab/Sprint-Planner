import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  projectDocList,
  projectDocPageGet,
  projectDocPageCreate,
  projectDocPageUpdate,
  projectDocPageDelete,
  projectDocSyncVersions,
  projectDocRevisionRestore,
} from "../controllers/projectDoc.controllers.js";

const router = Router({ mergeParams: true });

router.get("/", authenticateToken, projectDocList);
router.post("/sync-versions", authenticateToken, projectDocSyncVersions);
router.post("/pages", authenticateToken, projectDocPageCreate);
router.get("/pages/:pageId", authenticateToken, projectDocPageGet);
router.patch("/pages/:pageId", authenticateToken, projectDocPageUpdate);
router.delete("/pages/:pageId", authenticateToken, projectDocPageDelete);
router.post(
  "/pages/:pageId/revisions/:revisionId/restore",
  authenticateToken,
  projectDocRevisionRestore
);

export default router;
