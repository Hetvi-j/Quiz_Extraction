import express from "express";
import multer from "multer";
import {
  // Subject routes
  getAllSubjects,
  createSubject,
  deleteSubject,
  getSubjectWithPapers,
  // Paper routes
  createPaper,
  getPaperDetails,
  deletePaper,
  // Key upload
  uploadKey,
  // Student response upload
  uploadStudentResponse,
  uploadBulkStudentResponses,
  deleteStudentResponse,
  deleteStudentResultById,
  deleteAllStudentResponses,
  // Evaluation
  evaluatePaper,
  getPaperResults,
  // Question bank
  getSubjectQuestionBank,
  getAllQuestionBanks,
  deleteAllQuestions,
  // Difficulty analysis
  getPaperDifficultyAnalysis
} from "../controllers/paperController.js";

// Groq-related functions from freeOcrController
import {
  saveKeyData,
  saveResponseData
} from "../controllers/freeOcrController.js";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpg|jpeg|png/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname || mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG, and PNG files are allowed"));
    }
  }
});

// ==================== SUBJECT ROUTES ====================
router.get("/subjects", getAllSubjects);
router.post("/subjects", createSubject);
router.get("/subjects/:subjectId", getSubjectWithPapers);
router.delete("/subjects/:subjectId", deleteSubject);

// ==================== PAPER ROUTES ====================
router.post("/subjects/:subjectId/papers", createPaper);
router.get("/papers/:paperId", getPaperDetails);
router.delete("/papers/:paperId", deletePaper);

// ==================== KEY UPLOAD ====================
router.post("/papers/:paperId/key", upload.single("file"), uploadKey);
router.post("/papers/:paperId/key-data", saveKeyData); // Save pre-extracted key data (from Groq)

// ==================== STUDENT RESPONSE UPLOAD ====================
router.post("/papers/:paperId/response", upload.single("file"), uploadStudentResponse);
router.post("/papers/:paperId/responses", upload.array("files", 50), uploadBulkStudentResponses);
router.post("/papers/:paperId/response-data", saveResponseData); // Save pre-extracted response data (from Groq)
router.delete("/papers/:paperId/students/:enrollmentNumber", deleteStudentResponse);
router.delete("/papers/:paperId/results/:resultId", deleteStudentResultById);
router.delete("/papers/:paperId/students", deleteAllStudentResponses);

// ==================== EVALUATION ====================
router.post("/papers/:paperId/evaluate", evaluatePaper);
router.get("/papers/:paperId/results", getPaperResults);

// ==================== QUESTION BANK ====================
router.get("/question-bank", getAllQuestionBanks);
router.get("/subjects/:subjectId/question-bank", getSubjectQuestionBank);
router.delete("/subjects/:subjectId/question-bank", deleteAllQuestions);

// ==================== DIFFICULTY ANALYSIS ====================
router.get("/papers/:paperId/analysis", getPaperDifficultyAnalysis);

export default router;
