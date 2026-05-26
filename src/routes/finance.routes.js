import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
  financeOverview,
  accountList,
  accountCreate,
  accountUpdate,
  accountDelete,
  partitionCreate,
  partitionUpdate,
  partitionDelete,
  incomeCreate,
  incomeUpdate,
  incomeDelete,
  expenseCreate,
  expenseUpdate,
  expenseDelete,
  partitionTransferCreate,
  transactionList,
  projectProfitSummary,
  categoryList,
  categoryCreate,
  categoryUpdate,
  categoryDelete,
} from "../controllers/finance.controllers.js";
import {
  incomeSourceList,
  incomeSourceGet,
  incomeSourceCreate,
  incomeSourceUpdate,
  incomeSourceDelete,
} from "../controllers/incomeSource.controllers.js";
import {
  subscriptionDashboard,
  subscriptionList,
  subscriptionCreate,
  subscriptionUpdate,
  subscriptionDelete,
  subscriptionChargeNow,
  subscriptionProcessDue,
} from "../controllers/subscription.controllers.js";

const router = Router({ mergeParams: true });

router.get("/overview", authenticateToken, financeOverview);
router.get("/accounts", authenticateToken, accountList);
router.post("/accounts", authenticateToken, accountCreate);
router.patch("/accounts/:accountId", authenticateToken, accountUpdate);
router.delete("/accounts/:accountId", authenticateToken, accountDelete);
router.post("/accounts/:accountId/partitions", authenticateToken, partitionCreate);
router.patch("/accounts/:accountId/partitions/:partitionId", authenticateToken, partitionUpdate);
router.delete("/accounts/:accountId/partitions/:partitionId", authenticateToken, partitionDelete);

router.get("/transactions", authenticateToken, transactionList);
router.post("/income", authenticateToken, incomeCreate);
router.patch("/income/:incomeId", authenticateToken, incomeUpdate);
router.delete("/income/:incomeId", authenticateToken, incomeDelete);
router.post("/expense", authenticateToken, expenseCreate);
router.patch("/expense/:expenseId", authenticateToken, expenseUpdate);
router.delete("/expense/:expenseId", authenticateToken, expenseDelete);
router.post("/transfer", authenticateToken, partitionTransferCreate);
router.get("/project-profit", authenticateToken, projectProfitSummary);

router.get("/income-sources", authenticateToken, incomeSourceList);
router.post("/income-sources", authenticateToken, incomeSourceCreate);
router.get("/income-sources/:sourceId", authenticateToken, incomeSourceGet);
router.patch("/income-sources/:sourceId", authenticateToken, incomeSourceUpdate);
router.delete("/income-sources/:sourceId", authenticateToken, incomeSourceDelete);

router.get("/categories", authenticateToken, categoryList);
router.post("/categories", authenticateToken, categoryCreate);
router.patch("/categories/:categoryId", authenticateToken, categoryUpdate);
router.delete("/categories/:categoryId", authenticateToken, categoryDelete);

router.get("/subscriptions/dashboard", authenticateToken, subscriptionDashboard);
router.get("/subscriptions", authenticateToken, subscriptionList);
router.post("/subscriptions", authenticateToken, subscriptionCreate);
router.patch("/subscriptions/:subscriptionId", authenticateToken, subscriptionUpdate);
router.delete("/subscriptions/:subscriptionId", authenticateToken, subscriptionDelete);
router.post("/subscriptions/:subscriptionId/charge", authenticateToken, subscriptionChargeNow);
router.post("/subscriptions/process-due", authenticateToken, subscriptionProcessDue);

export default router;
