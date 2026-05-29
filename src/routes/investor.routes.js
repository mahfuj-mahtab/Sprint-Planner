import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  investorList,
  investorGet,
  investorCreate,
  investorUpdate,
  investorDelete,
  investmentCreate,
  investmentUpdate,
  investmentTransactionList,
  investmentDelete,
  investorDashboard,
  investorSummary,
} from "../controllers/investor.controllers.js";

const router = Router({ mergeParams: true });

// Investor management
router.get("/", authenticateToken, investorList);
router.post("/", authenticateToken, investorCreate);
router.get("/:investorId", authenticateToken, investorGet);
router.patch("/:investorId", authenticateToken, investorUpdate);
router.delete("/:investorId", authenticateToken, investorDelete);

// Investment transactions
router.get("/dashboard/summary", authenticateToken, investorSummary);
router.get("/dashboard/metrics", authenticateToken, investorDashboard);
router.post("/transactions", authenticateToken, investmentCreate);
router.get("/transactions/list", authenticateToken, investmentTransactionList);
router.patch("/transactions/:transactionId", authenticateToken, investmentUpdate);
router.delete("/transactions/:transactionId", authenticateToken, investmentDelete);

export default router;
