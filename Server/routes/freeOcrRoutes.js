import express from "express";
import multer from "multer";
import {
  healthCheck,
  extractFromFile,
  extractAnswerKey,
  extractStudentResponse
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

// ==================== FREE OCR ROUTES ====================

/**
 * @route   GET /api/free-ocr/health
 * @desc    Check if Free OCR service is running
 * @access  Public
 */
router.get("/health", healthCheck);

/**
 * @route   POST /api/free-ocr/extract
 * @desc    Extract quiz data from uploaded file (PDF or image)
 * @access  Public
 * @body    file - The file to extract from
 */
router.post("/extract", upload.single("file"), extractFromFile);

/**
 * @route   POST /api/free-ocr/extract-key
 * @desc    Extract answer key from uploaded file
 * @access  Public
 * @body    file - The answer key file
 */
router.post("/extract-key", upload.single("file"), extractAnswerKey);

/**
 * @route   POST /api/free-ocr/extract-response
 * @desc    Extract student response from uploaded file
 * @access  Public
 * @body    file - The student response file
 */
router.post("/extract-response", upload.single("file"), extractStudentResponse);

export default router;
