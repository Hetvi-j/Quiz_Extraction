import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Convert file to base64
function fileToBase64(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return fileBuffer.toString("base64");
}

// Get MIME type from file extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif"
  };
  return mimeTypes[ext] || "application/octet-stream";
}

// Extract questions from PDF/image using Gemini
export async function extractQuestionsWithGemini(filePath) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const base64Data = fileToBase64(filePath);
  const mimeType = getMimeType(filePath);

  const prompt = `You are a quiz/exam document parser. Extract all questions from this document.

Return a JSON object with this exact structure:
{
  "documentInfo": {
    "enrollmentNumber": "student enrollment number if visible, otherwise '0'",
    "date": "date if visible",
    "totalMarks": total marks if visible as number
  },
  "questions": [
    {
      "questionNumber": 1,
      "questionText": "the full question text",
      "questionType": "MCQ" or "SHORT" or "LONG" or "TRUE_FALSE",
      "marks": marks for this question as number (default 1),
      "options": ["A. option1", "B. option2", "C. option3", "D. option4"] (only for MCQ, empty array otherwise),
      "answer": "the correct answer if visible, or the student's answer if this is a response sheet"
    }
  ]
}

Important:
- Extract ALL questions from the document
- For MCQs, include all options in the options array
- If this is an answer key, extract the correct answers
- If this is a student response, extract their answers
- Return ONLY valid JSON, no markdown or explanation`;

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    },
    { text: prompt }
  ]);

  const response = await result.response;
  let text = response.text();

  // Clean up response - remove markdown code blocks if present
  text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let extraction;
  try {
    extraction = JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Gemini response:", text);
    throw new Error("Failed to parse Gemini response as JSON");
  }

  // Format and return questions
  const questions = (extraction.questions || []).map((q, idx) => ({
    questionNumber: q.questionNumber || idx + 1,
    questionText: q.questionText || "",
    question: q.questionText || "",
    questionType: q.questionType || "MCQ",
    marks: Number(q.marks) || 1,
    options: q.options || [],
    answer: q.answer || "",
    correctAnswer: q.answer || ""
  }));

  return {
    documentInfo: extraction.documentInfo || {},
    questions
  };
}

// Simple function that matches the Landing AI interface
export async function extractQuestionsFromPDF(filePath) {
  const result = await extractQuestionsWithGemini(filePath);
  return result.questions;
}

export default { extractQuestionsFromPDF, extractQuestionsWithGemini };
