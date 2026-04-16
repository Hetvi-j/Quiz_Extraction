import express from "express";
import multer from "multer";
import {
  healthCheck,
  extractFromFile,
  extractAnswerKey,
  extractStudentResponse
} from "../controllers/hybridOcrController.js";
import {
  evaluateSubjectiveAnswers,
  evaluateSubjectivePaper
} from "../controllers/freeOcrController.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpg|jpeg|png|bmp|tiff|tif|webp/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    if (extname) cb(null, true);
    else cb(new Error("Only PDF and image files are allowed"));
  }
});

router.get("/health", healthCheck);
router.post("/extract", upload.single("file"), extractFromFile);
router.post("/extract-key", upload.single("file"), extractAnswerKey);
router.post("/extract-response", upload.single("file"), extractStudentResponse);
router.post("/evaluate-subjective", evaluateSubjectiveAnswers);
router.post("/evaluate-paper/:paperId", evaluateSubjectivePaper);

export default router;

