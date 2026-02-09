// import fs from 'fs';
// import fetch from 'node-fetch';
// import FormData from 'form-data';
// import mongoose from 'mongoose'; // Needed for ObjectId validation/creation
// import Subject from '../models/Subject.js';
// import Upload from '../models/Upload.js';
// import Question from '../models/Question.js';

// // 📌 IMPORTANT: The URL for your Python OCR Microservice
// const PYTHON_OCR_URL = 'http://localhost:8000/ocr/process-file'; 

// // Helper function to send a single file to the Python OCR microservice.
// async function sendToOcrService(filePath, originalFilename) {
//     const fileStream = fs.createReadStream(filePath);
//     const form = new FormData();
//     form.append('file', fileStream, { filename: originalFilename });

//     const response = await fetch(PYTHON_OCR_URL, {
//         method: 'POST',
//         body: form,
//         headers: form.getHeaders() 
//     });

//     if (!response.ok) {
//         const errorDetail = await response.json().catch(() => ({ detail: 'Unknown error from OCR service' }));
//         throw new Error(`OCR/LLM Service Error (${response.status}): ${errorDetail.detail || response.statusText}`);
//     }
//     return response.json();
// }


// /**
//  * --------------------------------------------------------
//  * CONTROLLER: POST /process-individual-questions
//  * Handles file processing and stores questions individually.
//  * --------------------------------------------------------
//  */
// export const processIndividualQuestions = async (req, res) => {
//     const subjectName = req.body.subject;
//     const files = req.files; 
    
//     if (!subjectName || !files || files.length === 0) {
//         return res.status(400).json({ message: 'Missing subject or files.' });
//     }

//     try {
//         // 1. Find or Create Subject (Case-insensitive check)
//         let subjectDoc = await Subject.findOne({ name: subjectName.toLowerCase() });
//         if (!subjectDoc) {
//             subjectDoc = await Subject.create({ name: subjectName });
//         }
//         const subjectId = subjectDoc._id;
        
//         const finalUploads = [];

//         for (const file of files) {
            
//             // 2. Call OCR/LLM service
//             const ocrResult = await sendToOcrService(file.path, file.originalname);
            
//             if (!Array.isArray(ocrResult.quiz_data) || ocrResult.quiz_data.length === 0) {
//                  throw new Error(`LLM returned no valid quiz data for ${file.originalname}.`);
//             }
            
//             // 3. Create the Upload Record
//             const uploadDoc = await Upload.create({
//                 subjectId,
//                 filename: ocrResult.filename,
//                 questionCount: ocrResult.quiz_data.length // Dynamic count
//             });
            
//             const uploadId = uploadDoc._id;
            
//             // 4. Prepare and Save Questions Individually
//             const questionsToInsert = ocrResult.quiz_data.map(q => ({
//                 uploadId,
//                 subjectId,
//                 question: q.question,
//                 options: q.options,
//                 answer: q.answer, 
//                 difficulty: q.difficulty || 'Medium'
//             }));

//             const insertedQuestions = await Question.insertMany(questionsToInsert);
            
//             // 5. Cleanup temp file
//             fs.unlinkSync(file.path);
            
//             finalUploads.push({
//                 uploadId,
//                 filename: uploadDoc.filename,
//                 question_count: insertedQuestions.length
//             });
//         }

//         // 6. Send success response
//         res.status(201).json({
//             message: `${finalUploads.length} file(s) processed and individual questions saved successfully.`,
//             subject: subjectDoc.name,
//             subjectId: subjectId,
//             uploads: finalUploads,
//         });

//     } catch (error) {
//         console.error('CRITICAL PROCESSING FAILURE:', error.message);
        
//         // Ensure cleanup on failure
//         if (files) {
//             files.forEach(file => {
//                 try { fs.unlinkSync(file.path); } catch (e) { /* silent fail on cleanup */ }
//             });
//         }
        
//         res.status(500).json({ message: `Failed to process and save documents: ${error.message}` });
//     }
// };


// /**
//  * --------------------------------------------------------
//  * CONTROLLER: POST /select-individual-questions
//  * Selects a specified number of random questions from the Question model.
//  * --------------------------------------------------------
//  */
// export const selectIndividualQuestions = async (req, res) => {
//     const { subjectId, selection_criteria } = req.body;

//     if (!subjectId || !selection_criteria || selection_criteria.length === 0) {
//         return res.status(400).json({ message: 'Missing subjectId or selection_criteria.' });
//     }
    
//     if (!mongoose.Types.ObjectId.isValid(subjectId)) {
//         return res.status(400).json({ message: 'Invalid subject ID format.' });
//     }

//     try {
//         let finalQuestions = [];

//         for (const criterion of selection_criteria) {
//             const { uploadId, count, difficulty } = criterion;
            
//             if (!mongoose.Types.ObjectId.isValid(uploadId) || typeof count !== 'number' || count <= 0) {
//                  continue; // Skip invalid criteria item
//             }

//             // Build the query filter
//             const filter = { 
//                 uploadId: new mongoose.Types.ObjectId(uploadId),
//                 subjectId: new mongoose.Types.ObjectId(subjectId)
//             };

//             if (difficulty) {
//                 filter.difficulty = difficulty;
//             }

//             // Query the Question collection directly using aggregation for random selection
//             const randomQuestions = await Question.aggregate([
//                 { $match: filter },
//                 { $sample: { size: count } },
//                 { $project: { // Project to exclude the answer
//                     _id: 1, 
//                     question: 1,
//                     options: 1,
//                     difficulty: 1,
//                     source_upload_id: '$uploadId'
//                 }}
//             ]);

//             finalQuestions.push(...randomQuestions);
//         }

//         res.status(200).json({
//             message: `Successfully selected ${finalQuestions.length} questions.`,
//             subject_id: subjectId,
//             questions: finalQuestions,
//         });

//     } catch (error) {
//         console.error('INDIVIDUAL QUESTION SELECTION FAILURE:', error.message);
//         res.status(500).json({ message: 'Error processing question selection.', error: error.message });
//     }
// };