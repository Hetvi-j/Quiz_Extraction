// import fs from 'fs';
// import fetch from 'node-fetch';
// import FormData from 'form-data';
// // Imports the Document model, assuming it is correctly defined in '../models/Document.js'
// import Document from '../models/Document.js'; 

// // 📌 IMPORTANT: The URL for your Python OCR Microservice (running on port 8000)
// const PYTHON_OCR_URL = 'http://localhost:8000/ocr/process-file';

// /**
//  * Helper function to send a single file to the Python OCR microservice.
//  */
// async function sendToOcrService(filePath, originalFilename) {
//     const fileStream = fs.createReadStream(filePath);
//     const form = new FormData();
    
//     form.append('file', fileStream, { filename: originalFilename });

//     const response = await fetch(PYTHON_OCR_URL, {
//         method: 'POST',
//         body: form,
//         headers: form.getHeaders() // Necessary for multipart requests
//     });

//     if (!response.ok) {
//         const errorDetail = await response.json().catch(() => ({ detail: 'Unknown error from OCR service' }));
//         throw new Error(`OCR/LLM Service Error (${response.status}): ${errorDetail.detail || response.statusText}`);
//     }

//     return response.json();
// }

// /**
//  * --------------------------------------------------------
//  * CONTROLLER: POST /upload-and-process
//  * Handles file processing and MongoDB save.
//  * --------------------------------------------------------
//  */
// export const uploadAndProcess = async (req, res) => {
//     const subject = req.body.subject;
//     const files = req.files; 
    
//     if (!subject || !files || files.length === 0) {
//         return res.status(400).json({ message: 'Missing subject or files.' });
//     }

//     const documentsToSave = [];

//     try {
//         // --- 2. Process Files via OCR & LLM Microservice ---
//         for (const file of files) {
//             console.log(`Processing file: ${file.originalname}`);
            
//             const ocrResult = await sendToOcrService(file.path, file.originalname);
            
//             if (!Array.isArray(ocrResult.quiz_data) || ocrResult.quiz_data.length === 0) {
//                  throw new Error(`LLM returned no valid quiz data for ${file.originalname}. Check input quality.`);
//             }

//             // Prepare data object for saving (includes the answer for MongoDB storage)
//             documentsToSave.push({
//                 filename: ocrResult.filename,
//                 quiz_data: ocrResult.quiz_data,
//                 subject: subject
//             });
            
//             // IMPORTANT: Clean up the temporary file immediately after processing
//             fs.unlinkSync(file.path);
//         }

//         // --- 3. Save Processed Data to MongoDB ---
//         const savedDocs = await Document.insertMany(documentsToSave);
        
//         // --- 4. Prepare Response Data (Remove Answers for Client Security) ---
//         const processedDataForClient = savedDocs.map(doc => {
//             // Convert Mongoose document to plain object
//             const docObject = doc.toObject ? doc.toObject() : doc;
            
//             // Create a deep copy of quiz_data
//             const cleanQuizData = docObject.quiz_data.map(quizItem => {
//                 // Destructure to remove the 'answer' property from the copy
//                 const { answer, ...rest } = quizItem;
//                 return rest;
//             });

//             return {
//                 id: docObject._id,
//                 filename: docObject.filename,
//                 subject: docObject.subject,
//                 question_count: cleanQuizData.length,
//                 quiz_data: cleanQuizData, // This array does NOT contain answers
//             };
//         });

//         // --- 5. Send Final Successful Response ---
//         res.status(201).json({
//             message: `${savedDocs.length} file(s) processed and structured quiz data saved successfully.`,
//             subject: subject,
//             saved_documents_count: savedDocs.length,
//             processed_data: processedDataForClient,
//         });

//     } catch (error) {
//         console.error('CRITICAL PROCESSING FAILURE:', error.message);
        
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
//  * CONTROLLER: GET /quizzes/:subject
//  * Fetches quizzes by subject and strips answers.
//  * --------------------------------------------------------
//  */
// export const getQuizzesBySubject = async (req, res) => {
//     // Get the subject from the URL parameter, converting it to lowercase for querying
//     const requestedSubject = req.params.subject.toLowerCase();

//     try {
//         // 1. Find all documents matching the requested subject
//         const documents = await Document.find({ subject: requestedSubject }).lean(); // .lean() for faster, plain JavaScript objects

//         if (documents.length === 0) {
//             return res.status(404).json({ message: `No quizzes found for subject: ${requestedSubject}` });
//         }

//         // 2. Process documents: remove the 'answer' field from quiz_data for client security
//         const safeQuizzes = documents.map(doc => {
//             const safeQuizData = doc.quiz_data.map(quizItem => {
//                 // Use destructuring to exclude the 'answer' field
//                 const { answer, ...rest } = quizItem;
//                 return rest;
//             });

//             return {
//                 id: doc._id,
//                 filename: doc.filename,
//                 subject: doc.subject,
//                 question_count: safeQuizData.length,
//                 quiz_data: safeQuizData,
//             };
//         });

//         // 3. Send the secure list of quizzes
//         res.status(200).json({ 
//             message: `${safeQuizzes.length} documents found for ${requestedSubject}.`,
//             quizzes: safeQuizzes 
//         });

//     } catch (error) {
//         console.error('DATABASE FETCH FAILURE:', error.message);
//         res.status(500).json({ message: 'Error fetching quizzes from the database.' });
//     }
// };
