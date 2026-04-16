import express from "express";
import multer from "multer";
import {
  healthCheck,
  extractFromFile,
  extractAnswerKey,
  extractStudentResponse,
  saveKeyData,
  saveResponseData,
  evaluateSubjectiveAnswers,
  evaluateSubjectivePaper
} from "../controllers/geminiOcrController.js";

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
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpg|jpeg|png|bmp|tiff|tif|webp/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    if (extname) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files are allowed"));
    }
  }
});

// ==================== GEMINI OCR ROUTES ====================

/**
 * @route   GET /api/gemini-ocr/health
 * @desc    Check if Gemini OCR service is running
 * @access  Public
 */
router.get("/health", healthCheck);

/**
 * @route   POST /api/gemini-ocr/extract
 * @desc    Extract quiz data from uploaded file (PDF or image) using Gemini
 * @access  Public
 * @body    file - The file to extract from
 */
router.post("/extract", upload.single("file"), extractFromFile);

/**
 * @route   POST /api/gemini-ocr/extract-key
 * @desc    Extract answer key from uploaded file using Gemini
 * @access  Public
 * @body    file - The answer key file
 */
router.post("/extract-key", upload.single("file"), extractAnswerKey);

/**
 * @route   POST /api/gemini-ocr/extract-response
 * @desc    Extract student response from uploaded file using Gemini
 * @access  Public
 * @body    file - The student response file
 */
router.post("/extract-response", upload.single("file"), extractStudentResponse);

/**
 * @route   POST /api/gemini-ocr/paper/:paperId/save-key
 * @desc    Save extracted answer key to paper
 * @access  Public
 */
router.post("/paper/:paperId/save-key", saveKeyData);

/**
 * @route   POST /api/gemini-ocr/paper/:paperId/save-response
 * @desc    Save extracted student response to paper
 * @access  Public
 */
router.post("/paper/:paperId/save-response", saveResponseData);

/**
 * @route   POST /api/gemini-ocr/evaluate-subjective
 * @desc    Evaluate subjective answers using Gemini LLM
 * @access  Public
 * @body    { questions: [{ questionText, answerKey, studentAnswer, maxMarks }] }
 */
router.post("/evaluate-subjective", evaluateSubjectiveAnswers);

/**
 * @route   POST /api/gemini-ocr/evaluate-paper/:paperId
 * @desc    Evaluate a paper with subjective questions using Gemini LLM
 * @access  Public
 * @param   paperId - The paper ID to evaluate
 */
router.post("/evaluate-paper/:paperId", evaluateSubjectivePaper);

export default router;
