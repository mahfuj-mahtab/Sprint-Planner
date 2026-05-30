import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  learningOverview,
  topicCreate,
  topicUpdate,
  topicDelete,
  topicReorder,
  assignmentCreate,
  assignmentUpdate,
  assignmentDelete,
} from "../controllers/learning.controllers.js";

const router = Router({ mergeParams: true });

router.get("/overview", authenticateToken, learningOverview);
router.post("/topics", authenticateToken, topicCreate);
router.patch("/topics/reorder", authenticateToken, topicReorder);
router.patch("/topics/:topicId", authenticateToken, topicUpdate);
router.delete("/topics/:topicId", authenticateToken, topicDelete);
router.post("/topics/:topicId/assignments", authenticateToken, assignmentCreate);
router.patch("/assignments/:assignmentId", authenticateToken, assignmentUpdate);
router.delete("/assignments/:assignmentId", authenticateToken, assignmentDelete);

export default router;
