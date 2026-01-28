import { addSprintToOrg, orgGet } from "../controllers/org.controllers.js";
import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/fetch/:orgId", authenticateToken, orgGet);
router.post("/add/sprint/:orgId", authenticateToken, addSprintToOrg);


export default router;