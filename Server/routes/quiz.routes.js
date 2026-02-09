// routes/quizRoutes.js
import express from "express";
import multer from "multer";
import { extractQuizzesFromFolder } from "../controllers/quiz.controller.js";

const router = express.Router();

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({ storage });

// Route: POST /api/extract-quiz
//router.post("/extract-quiz", upload.single("file"), extractQuiz);
router.post('/extract-folder', extractQuizzesFromFolder);
export default router;
