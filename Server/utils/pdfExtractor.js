import axios from "axios";
import fs from "fs";
import FormData from "form-data";

const VA_API_KEY = process.env.LANDING_AI_API_KEY || "MHYxM3hyaGQzd3B0YWVhaXk1azJ4OmhrZXdXcTlVMlpuV1MyNDE2WU9oTnJCcWdGNzlTNEly";

// Schema for extracting questions from documents
const schemaContent = {
  type: "object",
  title: "Quiz Extraction Schema",
  properties: {
    documentInfo: {
      type: "object",
      properties: {
        enrollmentNumber: { type: "string", default: "0" },
        date: { type: "string" },
        totalMarks: { type: "number" }
      }
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionText: { type: "string" },
          questionType: { type: "string" },
          marks: { type: "number" },
          options: { type: "array", items: { type: "string" } },
          Answer: { type: "string" }
        },
        required: ["questionText"]
      }
    }
  },
  required: ["questions"]
};

// Extract questions from PDF/image file
export async function extractQuestionsFromPDF(filePath) {
  // STEP 1: Parse document
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
    throw new Error("No markdown returned from parse API");
  }

  // STEP 2: Extract structured data
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

  // Format and return questions
  const questions = (extraction.questions || []).map(q => ({
    questionText: q.questionText,
    question: q.questionText,
    questionType: q.questionType || "MCQ",
    marks: Number(q.marks) || 1,
    options: q.options || [],
    answer: q.Answer || q.answer || "",
    correctAnswer: q.Answer || q.answer || ""
  }));

  return questions;
}

export default { extractQuestionsFromPDF };
