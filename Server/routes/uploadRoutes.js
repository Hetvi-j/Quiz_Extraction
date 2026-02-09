import { Router } from 'express';
import multer from 'multer';
import { uploadAndProcess, getQuizzesBySubject } from '../controllers/uploadController.js';

const router = Router();
// Configure multer to temporarily store files in the 'uploads/' directory
const upload = multer({ dest: 'uploads/' }); 

// POST /api/v1/upload/upload-and-process
// Handles file upload, OCR/LLM processing, and saving to MongoDB
router.post(
    '/upload-and-process', 
    upload.array('files'), // 'files' must match the key used in the React FormData
    uploadAndProcess
);

// GET /api/v1/upload/quizzes/:subject
// Fetches all documents (quizzes) associated with a specific subject
router.get(
    '/quizzes/:subject',
    getQuizzesBySubject
);

export default router;
