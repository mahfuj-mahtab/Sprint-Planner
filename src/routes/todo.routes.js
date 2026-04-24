import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.middleware.js";
import {
    createTodo,
    getTodayTodos,
    getTodosByDate,
    getOverdueTodos,
    updateTodo,
    deleteTodo,
    getDayAnalysis
} from "../controllers/todo.controllers.js";

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// Create a new todo
router.post("/create", createTodo);

// Get todos for today
router.get("/today", getTodayTodos);

// Get todos for a specific date
router.get("/date", getTodosByDate);

// Get overdue todos
router.get("/overdue", getOverdueTodos);

// Get day analysis (available hours, etc.)
router.get("/analysis", getDayAnalysis);

// Update a todo
router.patch("/update/:todoId", updateTodo);

// Delete a todo
router.delete("/delete/:todoId", deleteTodo);

export default router;
