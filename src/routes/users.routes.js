import { Router } from "express";
import User from "../models/users.models.js";
import { userLogin, userRegister } from "../controllers/users.controllers.js";
const router = Router();



router.post("/login", userLogin);
router.post("/register", userRegister);

export default router;