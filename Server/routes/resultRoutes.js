import express from "express";
import { compareAnswers,compareAllAnswers } from "../controllers/resultController.js";

const router = express.Router();

// POST /api/quiz/compare
router.post("/quiz/compare", compareAnswers);
router.post("/quiz/compare_all", compareAllAnswers);

export default router;
