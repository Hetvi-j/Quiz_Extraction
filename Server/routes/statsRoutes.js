import express from "express";
import { getDashboardStats } from "../controllers/statsController.js";

const router = express.Router();

// GET /api/v1/stats - Get dashboard statistics
router.get("/", getDashboardStats);

export default router;
