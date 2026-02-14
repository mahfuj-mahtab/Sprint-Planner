import { Router } from "express";
// import User from "../models/users.models.js";
import { userLogin, userLogout, userProfile, userProfileEdit, userRegister } from "../controllers/users.controllers.js";
import { addTeamToOrg, orgCreate, orgDelete, orgEdit, orgFetchAllMembers, orgMemberAdd, orgMemberRemove } from "../controllers/org.controllers.js";
import { authenticateToken } from "../middlewares/auth.middleware.js";
const router = Router();



router.post("/login", userLogin);
router.post("/logout",authenticateToken, userLogout);

router.post("/register", userRegister);
router.get("/profile/", authenticateToken, userProfile);
router.patch("/profile/edit/", authenticateToken, userProfileEdit);
router.post("/org/create/", authenticateToken, orgCreate);
router.patch("/org/edit/:orgId", authenticateToken, orgEdit);
router.patch("/org/add/member/:orgId", authenticateToken, orgMemberAdd);
router.patch("/org/delete/member/:memberId/:orgId", authenticateToken, orgMemberRemove);
router.get("/org/fetch/all/members/:orgId", authenticateToken, orgFetchAllMembers);
router.delete("/org/delete/:orgId", authenticateToken, orgDelete);
router.post("/org/:orgId/team/add", authenticateToken, addTeamToOrg);

export default router;