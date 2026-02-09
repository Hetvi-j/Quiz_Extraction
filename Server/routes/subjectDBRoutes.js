import express from "express";
import multer from "multer";
import {
  getAllSubjects,
  createNewSubject,
  deleteSubjectById,
  getQuizzes,
  createQuiz,
  getQuizById,
  deleteQuiz,
  uploadAnswerKey,
  uploadResponses,
  evaluateQuiz,
  getResults
} from "../controllers/subjectDBController.js";
import { requireSignIn } from "../middlewares/authMiddelware.js";

const router = express.Router();

// Multer setup
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  })
});

// ==================== SUBJECT ROUTES ====================
// GET    /api/v2/subjects          - Get all subjects
// POST   /api/v2/subjects          - Create new subject
// DELETE /api/v2/subjects/:id      - Delete subject & its quizzes

router.get("/subjects", requireSignIn, getAllSubjects);
router.post("/subjects", requireSignIn, createNewSubject);
router.delete("/subjects/:subjectId", requireSignIn, deleteSubjectById);

// ==================== QUIZ ROUTES ====================
// GET    /api/v2/subjects/:id/quizzes          - Get all quizzes in subject
// POST   /api/v2/subjects/:id/quizzes          - Create quiz in subject
// GET    /api/v2/subjects/:id/quizzes/:quizId  - Get quiz details
// DELETE /api/v2/subjects/:id/quizzes/:quizId  - Delete quiz

router.get("/subjects/:subjectId/quizzes", requireSignIn, getQuizzes);
router.post("/subjects/:subjectId/quizzes", requireSignIn, createQuiz);
router.get("/subjects/:subjectId/quizzes/:quizId", requireSignIn, getQuizById);
router.delete("/subjects/:subjectId/quizzes/:quizId", requireSignIn, deleteQuiz);

// ==================== ANSWER KEY & RESPONSES ====================
// POST /api/v2/subjects/:id/quizzes/:quizId/key       - Upload answer key
// POST /api/v2/subjects/:id/quizzes/:quizId/responses - Upload student responses

router.post("/subjects/:subjectId/quizzes/:quizId/key", requireSignIn, upload.single("file"), uploadAnswerKey);
router.post("/subjects/:subjectId/quizzes/:quizId/responses", requireSignIn, upload.array("files", 100), uploadResponses);

// ==================== EVALUATION & RESULTS ====================
// POST /api/v2/subjects/:id/quizzes/:quizId/evaluate - Evaluate quiz
// GET  /api/v2/subjects/:id/quizzes/:quizId/results  - Get results

router.post("/subjects/:subjectId/quizzes/:quizId/evaluate", requireSignIn, evaluateQuiz);
router.get("/subjects/:subjectId/quizzes/:quizId/results", requireSignIn, getResults);

export default router;
