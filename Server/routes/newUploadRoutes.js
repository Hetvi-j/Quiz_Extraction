import { Router } from 'express';
import multer from 'multer';
import { processIndividualQuestions, selectIndividualQuestions } from '../controllers/newUploadController.js';

const router = Router();
const upload = multer({ dest: 'uploads/' }); 

// POST /api/v2/process-individual-questions
// Handles file upload and stores data across Subject, Upload, and Question models
router.post(
    '/process-individual-questions', 
    upload.array('files'),
    processIndividualQuestions
);

// POST /api/v2/select-individual-questions
// Selects questions from multiple Uploads (Documents) by ID
router.post(
    '/select-individual-questions',
    selectIndividualQuestions
);

export default router;