// // controllers/quizController.js
// import axios from "axios";
// import fs from "fs";
// import FormData from "form-data";
// import Quiz from "../models/quiz.model.js";

// const VA_API_KEY = "emI5MjY2YXkzcm94YmdldG1odTRmOlJYOHpLc2pRZUM3MVhNMTlNbjhoRkVuM2s3eURyUWdX"; // Store your API key in .env

// export const extractQuiz = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No file uploaded" });
//     }

//     const filePath = req.file.path;

//     // STEP 1: Parse document using Landing.ai API
//     const formParse = new FormData();
//     formParse.append("document", fs.createReadStream(filePath));

//     const parseResponse = await axios.post(
//       "https://api.va.landing.ai/v1/ade/parse",
//       formParse,
//       {
//         headers: {
//           ...formParse.getHeaders(),
//           Authorization: `Bearer ${VA_API_KEY}`,
//         },
//       }
//     );

//     const { markdown } = parseResponse.data;
//     if (!markdown) {
//       return res.status(422).json({ error: "No markdown returned from parse API" });
//     }

//     // STEP 2: Extract structured quiz fields
//     // const schemaContent = {
//     //   type: "object",
//     //   title: "Quiz Extraction Schema",
//     //   properties: {
//     //     questions: {
//     //       type: "array",
//     //       description: "List of questions extracted from the quiz document.",
//     //       items: {
//     //         type: "object",
//     //         properties: {
//     //           question_id: { type: "string" },
//     //           marks: { type: "string" },
//     //           question_text: { type: "string" },
//     //           question_type: { type: "string" },
//     //           options: { type: "array", items: { type: "string" } },
//     //           answer: { type: "string" },
//     //         },
//     //         required: ["question_text"],
//     //       },
//     //     },
//     //   },
//     //   required: ["questions"],
//     // };

//     const schemaContent = {
//   type: "object",
//   title: "Quiz Extraction Schema",
//   properties: {
//     documentInfo: {
//       type: "object",
//       description: "Core metadata and identifiers for the document.",
//       properties: {
//         enrollmentNumber: {
//           type: "number",
//           default: 0,
//           description: "The enrollment number associated with the document.",
//         },
//         date: {
//           type: "string",
//           description: "The date when the document or quiz was issued.",
//         },
//         totalMarks: {
//           type: "string",
//           description: "The total marks for the quiz or assessment.",
//         },
//       },
//       required: ["enrollmentNumber", "date"],
//     },
//     questions: {
//       type: "array",
//       description: "List of questions with options and selected answers.",
//       items: {
//         type: "object",
//         properties: {
//           questionText: {
//             type: "string",
//             description: "The text of the question.",
//           },
//           questionType: {
//             type: "string",
//             description: "The type of the question.",
//           },
//           marks: {
//             type: "string",
//             description: "Marks allocated for the question.",
//           },
//           options: {
//             type: "array",
//             description: "List of possible answer options.",
//             items: {
//               type: "string",
//             },
//           },
//           Answer: {
//             type: "string",
//             description: "The answer .",
//           },
         
//         },
//         required: ["questionText"],
//       },
//     },
//   },
//   required: ["documentInfo", "questions"],
// };


//     const formExtract = new FormData();
//     formExtract.append("markdown", markdown);
//     formExtract.append("schema", JSON.stringify(schemaContent));

//     const extractResponse = await axios.post(
//       "https://api.va.landing.ai/v1/ade/extract",
//       formExtract,
//       {
//         headers: {
//           ...formExtract.getHeaders(),
//           Authorization: `Bearer ${VA_API_KEY}`,
//         },
//       }
//     );

//     const extraction = extractResponse.data.extraction || {};
//     const documentInfo = extraction.documentInfo || {}; // ✅ define this
//     const questions = extraction.questions || [];

//     // STEP 3: Save to MongoDB
//     const quiz = new Quiz({
//       file_name: req.file.originalname,
//       documentInfo,
//       questions,
//     });

//     await quiz.save();

//     // Clean up uploaded file
//     fs.unlinkSync(filePath);

//     res.status(200).json({
//       message: "Quiz extracted and saved successfully",
//       data: quiz,
//     });
//   } catch (err) {
//     console.error("❌ Extraction failed:", err.response?.data || err.message);
//     res.status(500).json({
//       error: "Quiz extraction failed",
//       details: err.response?.data || err.message,
//     });
//   }
// };



// controllers/quizController.js
import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import Quiz1 from "../models/quiz_new.js";
import { addToQuestionBank } from "./questionBankController.js";
import { normalizeQuestion, validateAnswerConsistency } from "../utils/answerExtractor.js";

const VA_API_KEY =
  "NGQyeWhrM2FrbGE4c3RtOTk2d3B3Om1TbnZzWEMyalJHdXJTMW9EaDFQM2NSVG9aYjNnajB6";

// Main folders
const QUIZ_FOLDER_PATH = path.resolve(process.cwd(), "uploads");
const PROCESSED_FOLDER_PATH = path.resolve(process.cwd(), "processed_uploads");

// Create processed folder if missing
if (!fs.existsSync(PROCESSED_FOLDER_PATH)) {
  fs.mkdirSync(PROCESSED_FOLDER_PATH);
}

const schemaContent = {
  type: "object",
  title: "Quiz Extraction Schema",
  properties: {
    documentInfo: {
      type: "object",
      description: "Core metadata and identifiers for the document.",
      properties: {
        enrollmentNumber: {
          type: "number",
          default: 0,
          description: "The enrollment number associated with the document.",
        },
        date: {
          type: "string",
          description: "The date when the document or quiz was issued.",
        },
        totalMarks: {
          type: "number",
          description: "The total marks for the quiz or assessment.",
        },
      },
      required: ["enrollmentNumber", "date"],
    },
    questions: {
      type: "array",
      description: "List of questions with options and selected answers.",
      items: {
        type: "object",
        properties: {
          questionText: {
            type: "string",
            description: "The text of the question.",
          },
          questionType: {
            type: "string",
            description: "The type of the question (MCQ, SHORT, LONG, TRUE_FALSE, etc.).",
          },
          marks: {
            type: "number",
            description: "Marks allocated for the question.",
          },
          options: {
            type: "array",
            description: "List of possible answer options (for MCQ type, include all options like A, B, C, D).",
            items: {
              type: "string",
            },
          },
          answer: {
            type: "string",
            description: "The correct answer. For MCQs with multiple correct answers, concatenate them separated by comma (e.g., 'A, C'). Extract the letter/option itself, not the full text.",
          },
         
        },
        required: ["questionText"],
      },
    },
  },
  required: ["documentInfo", "questions"],
};

export const extractQuizzesFromFolder = async (req, res) => {
  let extractedQuizzes = [];
  let filesProcessed = 0;

  // Get subject from request body (sent from frontend)
  const subject = req.body?.subject || "GENERAL";

  try {
    const fileNames = fs.readdirSync(QUIZ_FOLDER_PATH);
    const quizFiles = fileNames.filter((name) =>
      name.match(/\.(pdf|jpg|png)$/i)
    );

    if (quizFiles.length === 0) {
      return res.status(200).json({
        message: `No quiz files found in folder: ${QUIZ_FOLDER_PATH}`,
        data: []
      });
    }

    console.log(`📂 Found ${quizFiles.length} files to process.`);

    for (const fileName of quizFiles) {
      const filePath = path.join(QUIZ_FOLDER_PATH, fileName);
      filesProcessed++;

      console.log(
        `🔄 Processing file ${filesProcessed}/${quizFiles.length}: ${fileName}`
      );

      try {
        // --------------------
        // STEP 1: PARSE
        // --------------------
        const formParse = new FormData();
        formParse.append("document", fs.createReadStream(filePath));

        const parseResponse = await axios.post(
          "https://api.va.landing.ai/v1/ade/parse",
          formParse,
          {
            headers: {
              ...formParse.getHeaders(),
              Authorization: `Bearer ${VA_API_KEY}`
            }
          }
        );

        const { markdown } = parseResponse.data;

        if (!markdown) {
          console.warn(`⚠ Skipped ${fileName}: No markdown returned`);
          continue;
        }

        // --------------------
        // STEP 2: EXTRACT
        // --------------------
        const formExtract = new FormData();
        formExtract.append("markdown", markdown);
        formExtract.append("schema", JSON.stringify(schemaContent));

        const extractResponse = await axios.post(
          "https://api.va.landing.ai/v1/ade/extract",
          formExtract,
          {
            headers: {
              ...formExtract.getHeaders(),
              Authorization: `Bearer ${VA_API_KEY}`
            }
          }
        );

        const extraction = extractResponse.data.extraction || {};

        // Normalize and validate extracted questions
        const normalizedQuestions = (extraction.questions || []).map((q, idx) => {
          // First normalize field names and answer format
          const questionData = {
            ...q,
            answer: q.answer || q.Answer || "",  // Normalize field name to lowercase 'answer'
            Answer: undefined  // Remove capitalized version
          };
          
          // Apply full normalization
          const normalized = normalizeQuestion(questionData);
          
          // Log validation warnings if any
          const validation = validateAnswerConsistency(normalized);
          if (!validation.isValid) {
            validation.warnings.forEach(warning => {
              console.warn(`⚠️ Question ${idx + 1}: ${warning}`);
            });
          } else {
            console.log(`✅ Question ${idx + 1}: Answer extracted correctly - "${normalized.answer}"`);
          }
          
          return normalized;
        });

        const quiz = new Quiz1({
          file_name: fileName,
          documentInfo: extraction.documentInfo || {},
          questions: normalizedQuestions
        });

        await quiz.save();
        extractedQuizzes.push(quiz);

        // --------------------
        // ADD TO QUESTION BANK (ONLY FROM ANSWER KEY - enrollment 0)
        // --------------------
        const enrollmentNumber = extraction.documentInfo?.enrollmentNumber;
        if (
          normalizedQuestions &&
          normalizedQuestions.length > 0 &&
          enrollmentNumber === 0
        ) {
          const bankResult = await addToQuestionBank(
            subject,
            normalizedQuestions,
            fileName
          );
          console.log(`📚 Question Bank (Answer Key): ${bankResult.message}`);
        } else if (enrollmentNumber !== 0) {
          console.log(`📝 Student sheet (${enrollmentNumber}) - skipped for question bank`);
        }

        // --------------------
        // MOVE FILE TO processed_uploads FOLDER
        // --------------------

        const newFilePath = path.join(PROCESSED_FOLDER_PATH, fileName);

        fs.renameSync(filePath, newFilePath);

        console.log(`📦 Moved processed file → ${newFilePath}`);
      } catch (err) {
        console.error(
          `❌ Failed to process ${fileName}:`,
          err.response?.data || err.message
        );
      }
    }

    res.status(200).json({
      message: `Completed: ${extractedQuizzes.length}/${quizFiles.length} files processed. Questions added to ${subject} question bank.`,
      processed_count: extractedQuizzes.length,
      total_files_found: quizFiles.length,
      subject: subject,
      data: extractedQuizzes
    });
  } catch (err) {
    console.error("❌ Folder processing failed:", err.message);

    res.status(500).json({
      error: "Quiz folder extraction failed",
      details: err.message,
      files_processed_before_error: filesProcessed
    });
  }
};
