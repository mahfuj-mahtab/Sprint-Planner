import { addSprintToOrg, deleteSprint, getSprintDetails, orgAddTaskToTeamInSprint, orgDelete, orgDeleteTaskFromTeamInSprint, orgGet, orgMemberAdd, orgMemberAddToTeam, orgMemberRemoveFromTeam, orgTeamCreate, orgTeamDelete, orgTeamFetchAll, orgTeamFetchOne } from "../controllers/org.controllers.js";
import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/fetch/:orgId", authenticateToken, orgGet);
router.post("/add/sprint/:orgId", authenticateToken, addSprintToOrg);
router.delete("/delete/sprint/:orgId/:sprintId", authenticateToken, deleteSprint);
router.get("/sprint/details/:sprintId", authenticateToken, getSprintDetails);

router.post("/team/add/:orgId",authenticateToken, orgTeamCreate)
router.delete("/team/delete/:orgId/:teamId", authenticateToken, orgTeamDelete)
router.get("/team/fetch/:orgId",authenticateToken, orgTeamFetchAll)
router.get("/single/team/:orgId/:teamId", authenticateToken, orgTeamFetchOne )
router.patch("/team/:teamId/member/add/:orgId", authenticateToken, orgMemberAddToTeam)
router.patch("/team/:teamId/member/remove/:orgId/:memberId", authenticateToken, orgMemberRemoveFromTeam)
router.post("/team/add/task/org/:orgId/sprint/:sprintId", authenticateToken, orgAddTaskToTeamInSprint)
router.delete("/team/delete/task/org/:orgId/sprint/:sprintId/:taskId/team/:teamId", authenticateToken, orgDeleteTaskFromTeamInSprint)
export default router;