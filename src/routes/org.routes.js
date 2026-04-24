import { addSprintToOrg, deleteSprint, editSprint, getSprintDetails, orgAddPlatformInSprint, orgAddPlatformPost, orgAddPlatformStatus, orgAddTaskToTeamInSprint, orgDelete, orgDeleteTaskFromTeamInSprint, orgEditTaskToTeamInSprint, orgFeatureAnalysisSummary, orgFeatureCreate, orgFeatureDelete, orgFeatureEdit, orgFeatureModuleCreate, orgFeatureModuleDelete, orgFeatureModuleEdit, orgGet, orgMemberAdd, orgMemberAddToTeam, orgMemberRemoveFromTeam, orgProjectCreate, orgProjectDelete, orgProjectDetails, orgProjectEdit, orgProjectList, orgProjectVersionAssignFeature, orgProjectVersionCreate, orgProjectVersionDelete, orgProjectVersionDetails, orgProjectVersionList, orgProjectVersionRemoveFeature, orgShowPlatformDetails, orgShowSingleTaskInSprint, orgTeamCreate, orgTeamDelete, orgTeamFetchAll, orgTeamFetchOne } from "../controllers/org.controllers.js";
import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";

const router = Router();
router.get("/fetch/:orgId", authenticateToken, orgGet);

router.get("/:orgId/projects", authenticateToken, orgProjectList);
router.post("/:orgId/projects", authenticateToken, orgProjectCreate);
router.get("/:orgId/projects/:projectId", authenticateToken, orgProjectDetails);
router.patch("/:orgId/projects/:projectId", authenticateToken, orgProjectEdit);
router.delete("/:orgId/projects/:projectId", authenticateToken, orgProjectDelete);

// Feature analysis (modules + features per project)
router.get("/:orgId/projects/:projectId/features/summary", authenticateToken, orgFeatureAnalysisSummary);
router.post("/:orgId/projects/:projectId/feature-modules", authenticateToken, orgFeatureModuleCreate);
router.patch("/:orgId/projects/:projectId/feature-modules/:moduleId", authenticateToken, orgFeatureModuleEdit);
router.delete("/:orgId/projects/:projectId/feature-modules/:moduleId", authenticateToken, orgFeatureModuleDelete);
router.post("/:orgId/projects/:projectId/feature-modules/:moduleId/features", authenticateToken, orgFeatureCreate);
router.patch("/:orgId/projects/:projectId/features/:featureId", authenticateToken, orgFeatureEdit);
router.delete("/:orgId/projects/:projectId/features/:featureId", authenticateToken, orgFeatureDelete);

// Versions (feature assignments are read-only snapshots)
router.get("/:orgId/projects/:projectId/versions", authenticateToken, orgProjectVersionList);
router.post("/:orgId/projects/:projectId/versions", authenticateToken, orgProjectVersionCreate);
router.get("/:orgId/projects/:projectId/versions/:versionId", authenticateToken, orgProjectVersionDetails);
router.delete("/:orgId/projects/:projectId/versions/:versionId", authenticateToken, orgProjectVersionDelete);
router.post("/:orgId/projects/:projectId/versions/:versionId/features", authenticateToken, orgProjectVersionAssignFeature);
router.delete("/:orgId/projects/:projectId/versions/:versionId/features/:featureId", authenticateToken, orgProjectVersionRemoveFeature);

router.post("/add/sprint/:orgId", authenticateToken, addSprintToOrg);
router.post("/project/:projectId/add/sprint/:orgId", authenticateToken, addSprintToOrg);
router.delete("/delete/sprint/:orgId/:sprintId", authenticateToken, deleteSprint);
router.get("/sprint/details/:sprintId", authenticateToken, getSprintDetails);
router.patch("/edit/sprint/:orgId/:sprintId", authenticateToken, editSprint);


router.post("/team/add/:orgId",authenticateToken, orgTeamCreate)
router.post("/project/:projectId/team/add/:orgId",authenticateToken, orgTeamCreate)
router.delete("/team/delete/:orgId/:teamId", authenticateToken, orgTeamDelete)
router.delete("/project/:projectId/team/delete/:orgId/:teamId", authenticateToken, orgTeamDelete)
router.get("/team/fetch/:orgId",authenticateToken, orgTeamFetchAll)
router.get("/project/:projectId/team/fetch/:orgId",authenticateToken, orgTeamFetchAll)
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
