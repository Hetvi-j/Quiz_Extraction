import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  getAllSubjects,
  createSubject,
  getUploadsBySubject,
  uploadAndProcessFiles,
  deleteSubject,
  getUploadDetails,
  // New quiz-based functions
  uploadToQuiz,
  evaluateQuizAttempts,
  getQuizDifficultyAnalysis,
  getSubjectQuizzes,
  getQuizResults,
  createSubjectQuiz,
  getAllSubjectsWithQuizzes
} from '../controllers/subjectUploadController.js';

const router = express.Router();

// Configure multer for file uploads
const uploadDir = 'uploads/subjects';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, and PNG are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit per file
  }
});

// ==================== LEGACY ROUTES (backward compatible) ====================
router.get('/subjects', getAllSubjects);
router.post('/subjects', createSubject);
router.delete('/subjects/:subjectId', deleteSubject);
router.get('/subjects/:subjectId/uploads', getUploadsBySubject);
router.post('/subjects/:subjectId/upload', upload.array('files', 50), uploadAndProcessFiles);
router.get('/uploads/:uploadId', getUploadDetails);

// ==================== NEW QUIZ-BASED ROUTES ====================

// Subject management (SubjectQuiz model)
router.get('/quiz-subjects', getAllSubjectsWithQuizzes);
router.post('/quiz-subjects', createSubjectQuiz);

// Quiz management
router.get('/quiz-subjects/:subjectId/quizzes', getSubjectQuizzes);

// Upload to specific quiz (pass quizName in body: "Quiz 1", "Quiz 2", etc.)
// POST /api/subject-upload/quiz-subjects/:subjectId/upload
// Body: { quizName: "Quiz 1", files: [...] }
router.post('/quiz-subjects/:subjectId/upload', upload.array('files', 50), uploadToQuiz);

// Evaluate pending attempts for a quiz
router.post('/quiz-subjects/:subjectId/quizzes/:quizId/evaluate', evaluateQuizAttempts);

// Get quiz results
router.get('/quiz-subjects/:subjectId/quizzes/:quizId/results', getQuizResults);

// Get difficulty analysis for a quiz
router.get('/quiz-subjects/:subjectId/quizzes/:quizId/difficulty', getQuizDifficultyAnalysis);
router.get('/quiz-subjects/:subjectId/difficulty', getQuizDifficultyAnalysis); // with quizName query param

export default router;
