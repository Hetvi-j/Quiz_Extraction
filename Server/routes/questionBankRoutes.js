import express from "express";
import {
  getQuestionBank,
  getAllSubjects,
  generateQuiz,
  addQuestions,
  migrateExistingQuizzes,
  clearQuestionBank
} from "../controllers/questionBankController.js";

const router = express.Router();

// GET /api/v1/question-bank/subjects - List all subjects
router.get("/subjects", getAllSubjects);

// GET /api/v1/question-bank/:subject - Get questions by subject
router.get("/:subject", getQuestionBank);

// POST /api/v1/question-bank/add - Add questions to bank
router.post("/add", addQuestions);

// POST /api/v1/question-bank/generate - Generate quiz from bank
router.post("/generate", generateQuiz);

// POST /api/v1/question-bank/migrate - Migrate existing quizzes to bank
router.post("/migrate", migrateExistingQuizzes);

// POST /api/v1/question-bank/clear - Clear question bank for a subject
router.post("/clear", clearQuestionBank);

export default router;
