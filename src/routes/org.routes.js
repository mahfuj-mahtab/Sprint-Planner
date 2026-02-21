import { addSprintToOrg, deleteSprint, editSprint, getSprintDetails, orgAddPlatformInSprint, orgAddPlatformPost, orgAddPlatformStatus, orgAddTaskToTeamInSprint, orgDelete, orgDeleteTaskFromTeamInSprint, orgEditTaskToTeamInSprint, orgGet, orgMemberAdd, orgMemberAddToTeam, orgMemberRemoveFromTeam, orgShowPlatformDetails, orgShowSingleTaskInSprint, orgTeamCreate, orgTeamDelete, orgTeamFetchAll, orgTeamFetchOne } from "../controllers/org.controllers.js";
import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/fetch/:orgId", authenticateToken, orgGet);
router.post("/add/sprint/:orgId", authenticateToken, addSprintToOrg);
router.delete("/delete/sprint/:orgId/:sprintId", authenticateToken, deleteSprint);
router.get("/sprint/details/:sprintId", authenticateToken, getSprintDetails);
router.patch("/edit/sprint/:orgId/:sprintId", authenticateToken, editSprint);


router.post("/team/add/:orgId",authenticateToken, orgTeamCreate)
router.delete("/team/delete/:orgId/:teamId", authenticateToken, orgTeamDelete)
router.get("/team/fetch/:orgId",authenticateToken, orgTeamFetchAll)
router.get("/single/team/:orgId/:teamId", authenticateToken, orgTeamFetchOne )
router.patch("/team/:teamId/member/add/:orgId", authenticateToken, orgMemberAddToTeam)
router.patch("/team/:teamId/member/remove/:orgId/:memberId", authenticateToken, orgMemberRemoveFromTeam)
router.post("/team/add/task/org/:orgId/sprint/:sprintId", authenticateToken, orgAddTaskToTeamInSprint)
router.delete("/team/delete/task/org/:orgId/sprint/:sprintId/:taskId/team/:teamId", authenticateToken, orgDeleteTaskFromTeamInSprint)
router.get("/sprint/single/task/org/:orgId/sprint/:sprintId/:taskId", authenticateToken, orgShowSingleTaskInSprint)
router.patch("/sprint/single/task/edit/org/:orgId/sprint/:sprintId/:taskId", authenticateToken, orgEditTaskToTeamInSprint)
router.post("/contentPlanner/org/:orgId/add/platform/", authenticateToken, orgAddPlatformInSprint)
router.post("/contentPlanner/org/:orgId/add/platform/status/:platformId/", authenticateToken, orgAddPlatformStatus)
router.get("/contentPlanner/org/:orgId/show/platform/details/:platformId/", authenticateToken, orgShowPlatformDetails)

router.post("/contentPlanner/org/:orgId/add/platform/post/:platformId/sprint/:sprintId/", authenticateToken, orgAddPlatformPost)


export default router;