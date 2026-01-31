import { addSprintToOrg, deleteSprint, getSprintDetails, orgAddTaskToTeamInSprint, orgGet, orgMemberAdd, orgTeamCreate, orgTeamFetchAll, orgTeamFetchOne } from "../controllers/org.controllers.js";
import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/fetch/:orgId", authenticateToken, orgGet);
router.post("/add/sprint/:orgId", authenticateToken, addSprintToOrg);
router.delete("/delete/sprint/:orgId/:sprintId", authenticateToken, deleteSprint);
router.get("/sprint/details/:sprintId", authenticateToken, getSprintDetails);

router.post("/team/add/:orgId",authenticateToken, orgTeamCreate)
router.get("/team/fetch/:orgId",authenticateToken, orgTeamFetchAll)
router.get("/single/team/:orgId/:teamId", authenticateToken, orgTeamFetchOne )
router.post("/team/add/task/org/:orgId/sprint/:sprintId", authenticateToken, orgAddTaskToTeamInSprint)
export default router;