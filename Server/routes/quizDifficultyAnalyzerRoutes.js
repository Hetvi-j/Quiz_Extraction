import express from "express";
import { getQuizSummary, analyzeQuizPerformance } from "../controllers/quizDifficultyAnalyzer.js";

const router = express.Router();

// Route to update per-question stats (called after each question is answered)

// Route to get overall quiz summary and difficulty
router.get("/summary", getQuizSummary);
router.get("/analyze", analyzeQuizPerformance);

export default router;
 