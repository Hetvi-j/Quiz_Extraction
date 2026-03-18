import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Subject from "../models/Subject.js";
import Paper from "../models/Paper.js";
import Result from "../models/Result.js";
import QuestionBank from "../models/QuestionBank.js";


const VA_API_KEY = process.env.LANDING_AI_API_KEY || "bnoxd3ozb2VsanV2OHZoNTJuc3g2Om1CWXRlVzVYeUh5bEdQa28yajdZcWs2VUNiSU5uY0hw"


// Schema for extracting questions from documents
const schemaContent = {
  type: "object",
  title: "Quiz Extraction Schema",
  description: "Extract all questions from quiz documents, answer keys, or student answer sheets",
  properties: {
    documentInfo: {
      type: "object",
      description: "Document metadata",
      properties: {
        enrollmentNumber: { type: "string", default: "0", description: "Student enrollment number, use '0' if this is an answer key" },
        date: { type: "string", description: "Date on the document" },
        totalMarks: { type: "number", description: "Total marks for the quiz" }
      }
    },
    questions: {
      type: "array",
      description: "List of ALL questions found in the document. For answer keys, extract each numbered item as a question with its answer.",
      items: {
        type: "object",
        properties: {
          questionText: { type: "string", description: "The question text or question number (e.g., 'Question 1' or 'Q1' or just '1')" },
          questionType: { type: "string", description: "MCQ, SHORT, LONG, or TRUE_FALSE" },
          marks: { type: "number", description: "Marks for this question, default 1" },
          options: { type: "array", items: { type: "string" }, description: "Options for MCQ questions (A, B, C, D)" },
          Answer: { type: "string", description: "The correct answer or selected answer (e.g., 'A', 'B', 'True', etc.)" }
        },
        required: ["questionText", "Answer"]
      }
    }
  },
  required: ["questions"]
};

// Helper function to extract questions using Landing AI
async function extractWithLandingAI(filePath, fileName) {
  console.log(`\n⚡ Landing AI: Processing ${fileName}...`);

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

  console.log("📄 Parsed markdown preview:");
  console.log(markdown.substring(0, 500));
  console.log("...");

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
  console.log(`✅ Extraction complete: ${extraction.questions?.length || 0} questions found`);

  return extraction;
}

// Helper function to extract questions using Gemini
async function extractWithGemini(filePath, fileName) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured in .env");
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString("base64");

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  };
  const mimeType = mimeTypes[ext] || "application/octet-stream";

  const prompt = `You are a quiz/exam document parser. Your job is to extract ALL questions from this document.

IMPORTANT: This could be:
1. An ANSWER KEY - contains questions with correct answers (no student enrollment number)
2. A STUDENT ANSWER SHEET - contains student's responses (has enrollment number)
3. A QUESTION PAPER - contains questions without answers

For ALL types, you MUST extract every single question you can find.

Return a JSON object with this exact structure:
{
  "documentInfo": {
    "enrollmentNumber": "0" if this is an answer key or question paper (no student info), otherwise the student's enrollment number as string,
    "date": "date if visible, otherwise empty string",
    "totalMarks": total marks if visible as number, otherwise 0
  },
  "questions": [
    {
      "questionText": "the complete question text including question number",
      "questionType": "MCQ" or "SHORT" or "LONG" or "TRUE_FALSE",
      "marks": marks for this question as number (default 1),
      "options": ["A. option1", "B. option2", "C. option3", "D. option4"] (for MCQ only, empty array for others),
      "Answer": "the correct answer from the answer key, or student's answer, or empty if not available"
    }
  ]
}

CRITICAL RULES:
1. Extract EVERY question - do not skip any
2. If you see "Q1", "1.", "Question 1" etc - that's a question, extract it
3. For answer keys: extract ALL questions with their correct answers
4. Even if only answers are visible (like "1. A, 2. B, 3. C"), create questions for each
5. Include the question number in questionText
6. Return ONLY valid JSON, no markdown code blocks, no explanation
7. If the document has numbered items with answers, those are questions - extract them all`;

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

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse Gemini response:", text);
    throw new Error("Failed to parse Gemini response as JSON");
  }
}

// Helper function to extract questions from uploaded file
async function extractQuestionsFromFile(filePath, fileName, extractorAPI = "landing") {
  console.log(`📡 Using ${extractorAPI.toUpperCase()} API for extraction: ${fileName}`);

  if (extractorAPI === "gemini") {
    return await extractWithGemini(filePath, fileName);
  } else {
    return await extractWithLandingAI(filePath, fileName);
  }
}

// ==================== SUBJECT CRUD ====================

// Get all subjects
export const getAllSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ createdAt: -1 });

    // Get paper counts for each subject
    const subjectsWithCounts = await Promise.all(
      subjects.map(async (subject) => {
        const paperCount = await Paper.countDocuments({ subject: subject._id });
        return {
          ...subject.toObject(),
          totalPapers: paperCount
        };
      })
    );

    res.status(200).json({
      success: true,
      subjects: subjectsWithCounts
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new subject
export const createSubject = async (req, res) => {
  try {
    const { name, description, code } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Subject name is required" });
    }

    const existingSubject = await Subject.findOne({ name: name.toUpperCase() });
    if (existingSubject) {
      return res.status(400).json({ success: false, message: "Subject already exists" });
    }

    const subject = new Subject({
      name: name.toUpperCase(),
      description: description || "",
      code: code || ""
    });

    await subject.save();

    // Create empty question bank for this subject
    const questionBank = new QuestionBank({
      subject: subject._id,
      subjectName: subject.name,
      questions: []
    });
    await questionBank.save();

    res.status(201).json({
      success: true,
      message: "Subject created successfully",
      subject
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a subject
export const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    // Delete all papers under this subject
    await Paper.deleteMany({ subject: subjectId });

    // Delete all results for papers under this subject
    await Result.deleteMany({ subject: subjectId });

    // Delete question bank for this subject
    await QuestionBank.deleteOne({ subject: subjectId });

    // Delete the subject
    await Subject.findByIdAndDelete(subjectId);

    res.status(200).json({
      success: true,
      message: "Subject and all associated data deleted"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get subject by ID with papers
export const getSubjectWithPapers = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const papers = await Paper.find({ subject: subjectId })
      .select("paperName paperNumber totalMarks totalStudents key.uploadedAt key.questions studentResponses createdAt")
      .sort({ paperNumber: 1 });

    // Add totalQuestions to each paper
    const papersWithQuestionCount = papers.map(paper => ({
      ...paper.toObject(),
      totalQuestions: paper.key?.questions?.length || 0
    }));

    res.status(200).json({
      success: true,
      subject,
      papers: papersWithQuestionCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== PAPER CRUD ====================

// Create a new paper for a subject
export const createPaper = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { paperName } = req.body;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    // Get the next paper number
    const paperCount = await Paper.countDocuments({ subject: subjectId });
    const paperNumber = paperCount + 1;

    const paper = new Paper({
      subject: subjectId,
      paperName: paperName || `Paper ${paperNumber}`,
      paperNumber
    });

    await paper.save();

    // Update subject's total papers
    await Subject.findByIdAndUpdate(subjectId, { $inc: { totalPapers: 1 } });

    res.status(201).json({
      success: true,
      message: "Paper created successfully",
      paper
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Paper name already exists for this subject" });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get paper details
export const getPaperDetails = async (req, res) => {
  try {
    const { paperId } = req.params;

    const paper = await Paper.findById(paperId).populate("subject", "name code");
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    res.status(200).json({
      success: true,
      paper,
      totalQuestions: paper.key?.questions?.length || 0,
      totalMarks: paper.totalMarks || 0
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a paper
export const deletePaper = async (req, res) => {
  try {
    const { paperId } = req.params;

    const paper = await Paper.findById(paperId);
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    // Delete all results for this paper
    await Result.deleteMany({ paper: paperId });

    // Decrement subject's total papers
    await Subject.findByIdAndUpdate(paper.subject, { $inc: { totalPapers: -1 } });

    await Paper.findByIdAndDelete(paperId);

    res.status(200).json({
      success: true,
      message: "Paper deleted successfully"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== KEY UPLOAD ====================

// Upload answer key for a paper
export const uploadKey = async (req, res) => {
  try {
    const { paperId } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const paper = await Paper.findById(paperId).populate("subject");
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    console.log("\n========== ANSWER KEY UPLOAD ==========");
    console.log("File:", fileName);
    console.log("Paper:", paper.paperName);

    // Extract questions from the uploaded file
    const extraction = await extractWithLandingAI(filePath, fileName);

    console.log("📊 Raw extraction result:", JSON.stringify(extraction, null, 2));

    // Format questions for storage
    let questions = (extraction.questions || []).map(q => ({
      questionText: q.questionText,
      questionType: q.questionType || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.Answer || q.answer || ""
    }));

    // Calculate total marks
    let totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

    // If no questions extracted but we have totalMarks from documentInfo, create placeholder questions
    if (questions.length === 0 && extraction.documentInfo?.totalMarks) {
      const numQuestions = Number(extraction.documentInfo.totalMarks) || 6;
      console.log(`⚠️ No questions extracted, creating ${numQuestions} placeholder questions from totalMarks`);

      for (let i = 1; i <= numQuestions; i++) {
        questions.push({
          questionText: `Question ${i}`,
          questionType: "MCQ",
          marks: 1,
          options: [],
          answer: ""
        });
      }
      totalMarks = numQuestions;
    }

    console.log(`✅ Total: ${questions.length} questions, ${totalMarks} marks`);

    // Update paper with key
    paper.key = {
      fileName,
      questions,
      uploadedAt: new Date()
    };
    paper.totalMarks = totalMarks;

    await paper.save();

    // Add questions to question bank for this subject
    await addQuestionsToBank(paper.subject._id, paper.subject.name, questions, paper._id, fileName);

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: "Answer key uploaded successfully",
      totalQuestions: questions.length,
      totalMarks
    });
  } catch (error) {
    console.error("Key upload error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== STUDENT RESPONSE UPLOAD ====================

// Upload student response for a paper
export const uploadStudentResponse = async (req, res) => {
  try {
    const { paperId } = req.params;
    const { enrollmentNumber, extractorAPI = "landing" } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    if (!enrollmentNumber) {
      return res.status(400).json({ success: false, message: "Enrollment number is required" });
    }

    const paper = await Paper.findById(paperId);
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Extract questions from the uploaded file
    const extraction = await extractQuestionsFromFile(filePath, fileName, extractorAPI);

    // Format questions for storage
    const questions = (extraction.questions || []).map(q => ({
      questionText: q.questionText,
      questionType: q.questionType || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.Answer || q.answer || ""
    }));

    // Check if student already submitted
    const existingIndex = paper.studentResponses.findIndex(
      sr => sr.enrollmentNumber === enrollmentNumber
    );

    if (existingIndex >= 0) {
      // Update existing response
      paper.studentResponses[existingIndex] = {
        enrollmentNumber,
        fileName,
        questions,
        submittedAt: new Date()
      };
    } else {
      // Add new response
      paper.studentResponses.push({
        enrollmentNumber,
        fileName,
        questions,
        submittedAt: new Date()
      });
    }

    await paper.save();

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: `Student response uploaded for enrollment ${enrollmentNumber}`,
      totalQuestions: questions.length
    });
  } catch (error) {
    console.error("Student response upload error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Bulk upload student responses
export const uploadBulkStudentResponses = async (req, res) => {
  try {
    const { paperId } = req.params;
    const extractorAPI = req.body?.extractorAPI || "simple";

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const paper = await Paper.findById(paperId);
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    console.log(`Processing ${req.files.length} student responses (mode: ${extractorAPI})`);

    const results = [];

    for (const file of req.files) {
      try {
        let enrollmentNumber = file.originalname.replace(/\.[^/.]+$/, "");
        let questions = [];

        if (extractorAPI === "simple") {
          // Simple mode: just use filename as enrollment, empty questions (will be filled during evaluation)
          console.log(`Simple mode: ${enrollmentNumber}`);
          questions = [];
        } else {
          // API mode: extract questions from file
          try {
            const extraction = await extractQuestionsFromFile(file.path, file.originalname, extractorAPI);
            enrollmentNumber = extraction.documentInfo?.enrollmentNumber?.toString() || enrollmentNumber;
            questions = (extraction.questions || []).map(q => ({
              questionText: q.questionText,
              questionType: q.questionType || "MCQ",
              marks: Number(q.marks) || 1,
              options: q.options || [],
              answer: q.Answer || q.answer || ""
            }));
          } catch (extractErr) {
            console.error(`API extraction failed for ${file.originalname}, using simple mode:`, extractErr.message);
            // Fallback to simple mode
            questions = [];
          }
        }

        // Check if student already submitted
        const existingIndex = paper.studentResponses.findIndex(
          sr => sr.enrollmentNumber === enrollmentNumber
        );

        if (existingIndex >= 0) {
          paper.studentResponses[existingIndex] = {
            enrollmentNumber,
            fileName: file.originalname,
            questions,
            submittedAt: new Date()
          };
        } else {
          paper.studentResponses.push({
            enrollmentNumber,
            fileName: file.originalname,
            questions,
            submittedAt: new Date()
          });
        }

        results.push({ fileName: file.originalname, enrollmentNumber, status: "success" });

        // Clean up
        fs.unlinkSync(file.path);
      } catch (err) {
        console.error("Error processing file:", err.message);
        results.push({ fileName: file.originalname, status: "failed", error: err.message });
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    await paper.save();

    res.status(200).json({
      success: true,
      message: `Processed ${results.filter(r => r.status === "success").length}/${req.files.length} files`,
      results,
      totalStudents: paper.studentResponses.length
    });
  } catch (error) {
    console.error("Bulk upload error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a student response
export const deleteStudentResponse = async (req, res) => {
  try {
    const { paperId, enrollmentNumber } = req.params;

    const paper = await Paper.findById(paperId);
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    const initialLength = paper.studentResponses.length;
    paper.studentResponses = paper.studentResponses.filter(
      sr => sr.enrollmentNumber !== enrollmentNumber
    );

    if (paper.studentResponses.length === initialLength) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    await paper.save();

    // Also delete the result if exists
    await Result.deleteOne({ paper: paperId, enrollmentNumber });

    res.status(200).json({
      success: true,
      message: `Deleted student ${enrollmentNumber}`,
      totalStudents: paper.studentResponses.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a student result by result ID
export const deleteStudentResultById = async (req, res) => {
  try {
    const { paperId, resultId } = req.params;

    // Find the result first to get the enrollment number
    const result = await Result.findById(resultId);
    if (!result) {
      return res.status(404).json({ success: false, message: "Result not found" });
    }

    const paper = await Paper.findById(paperId);
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    // Delete the student response from paper
    paper.studentResponses = paper.studentResponses.filter(
      sr => sr.enrollmentNumber !== result.enrollmentNumber
    );
    await paper.save();

    // Delete the result
    await Result.findByIdAndDelete(resultId);

    res.status(200).json({
      success: true,
      message: `Deleted student result`,
      totalStudents: paper.studentResponses.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete all student responses
export const deleteAllStudentResponses = async (req, res) => {
  try {
    const { paperId } = req.params;

    const paper = await Paper.findById(paperId);
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    const deletedCount = paper.studentResponses.length;
    paper.studentResponses = [];
    await paper.save();

    // Also delete all results
    await Result.deleteMany({ paper: paperId });

    res.status(200).json({
      success: true,
      message: `Deleted all ${deletedCount} students`,
      totalStudents: 0
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== RESULT CALCULATION ====================

// Evaluate all students for a paper
export const evaluatePaper = async (req, res) => {
  try {
    const { paperId } = req.params;

    const paper = await Paper.findById(paperId).populate("subject");
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    if (!paper.key || !paper.key.questions || paper.key.questions.length === 0) {
      return res.status(400).json({ success: false, message: "Answer key not uploaded for this paper" });
    }

    if (paper.studentResponses.length === 0) {
      return res.status(400).json({ success: false, message: "No student responses found" });
    }

    const answerKey = paper.key.questions;
    const totalMarks = paper.totalMarks;
    const allResults = [];

    // Helper to extract option letter(s) from answer like "B", "A,C", "A,B,D,E"
    const extractLetters = (answer) => {
      if (!answer) return [];
      const str = answer.toString().toUpperCase().trim();

      // Check if answer looks like comma-separated options (e.g., "A,B", "A,C,D", "A,B,C,D,E")
      // This handles multi-select MCQs with 2, 3, 4, or 5 correct options
      const commaPattern = /^[A-E]([\s]*,[\s]*[A-E])+$/;
      if (commaPattern.test(str)) {
        const letters = str.match(/[A-E]/g) || [];
        return [...new Set(letters)];
      }

      // Short answer like "B" or "AC"
      if (str.length <= 3) {
        const letters = str.match(/[A-E]/g) || [];
        return [...new Set(letters)];
      }

      // Single letter followed by delimiter (e.g., "B - explanation")
      const match = str.match(/^([A-E])[\s,\-\.\)\:]/);
      if (match) return [match[1]];

      // Fallback: extract all letters A-E from first 15 chars
      const firstPart = str.substring(0, 15);
      const letters = firstPart.match(/[A-E]/g) || [];
      return [...new Set(letters)];
    };

    for (const studentResponse of paper.studentResponses) {
      const questionStats = answerKey.map((q, i) => ({
        questionNumber: i + 1,
        questionText: q.questionText?.trim() || "",
        correctAnswer: (q.answer || "").trim(),
        studentAnswer: "",
        marks: Number(q.marks) || 0,
        isCorrect: false,
        obtained: 0
      }));

      let obtainedMarks = 0;

      // Compare answers with enhanced partial marking
      let fullCorrect = 0;
      let partialCorrect = 0;
      let wrong = 0;

      // Helper to normalize text for subjective answer comparison
      const normalizeAnswer = (text) => {
        if (!text) return "";
        return text.toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      };

      for (let i = 0; i < studentResponse.questions.length && i < questionStats.length; i++) {
        const studentQ = studentResponse.questions[i];
        const correctQ = questionStats[i];
        const keyQuestion = answerKey[i];
        const questionType = (keyQuestion.questionType || "MCQ").toUpperCase();

        let obtainedForQuestion = 0;

        if (questionType === "MCQ") {
          // MCQ: Extract letters for comparison (handles "B - Because..." format)
          let correctAnswers = extractLetters(correctQ.correctAnswer);
          let studentAnswers = extractLetters(studentQ.answer || "");

          // Calculate partial marks
          const perOptionMark = correctQ.marks / Math.max(correctAnswers.length, 1);

          // Check each correct answer
          correctAnswers.forEach(correctOpt => {
            if (studentAnswers.includes(correctOpt)) {
              obtainedForQuestion += perOptionMark;
            }
          });

          correctQ.studentAnswer = studentAnswers.join(",") || (studentQ.answer || "").trim();
        } else if (questionType === "TRUE_FALSE") {
          // TRUE_FALSE: Can be simple (True/False) or with justify
          const correctAns = (correctQ.correctAnswer || "").toString();
          const studentAns = (studentQ.answer || "").toString();

          // Extract True/False part
          const extractTrueFalse = (text) => {
            const lower = text.toLowerCase().trim();
            if (lower.startsWith("true") || lower.startsWith("t ") || lower === "t") return "true";
            if (lower.startsWith("false") || lower.startsWith("f ") || lower === "f") return "false";
            return "";
          };

          // Extract justify part (everything after True/False)
          const extractJustify = (text) => {
            const lower = text.toLowerCase().trim();
            let justify = lower
              .replace(/^(true|false|t|f)[\s\-\.\,\:\;]*/i, "")
              .replace(/^(because|reason|as|since)[\s\-\.\,\:\;]*/i, "")
              .trim();
            return justify;
          };

          const correctTF = extractTrueFalse(correctAns);
          const studentTF = extractTrueFalse(studentAns);
          const correctJustify = normalizeAnswer(extractJustify(correctAns));
          const studentJustify = normalizeAnswer(extractJustify(studentAns));

          // Check if it has justify component
          const hasJustify = correctJustify.length > 3;

          if (hasJustify) {
            // Split marks: 40% for True/False, 60% for justify
            const tfMarks = correctQ.marks * 0.4;
            const justifyMarks = correctQ.marks * 0.6;

            // Check True/False part
            if (correctTF && studentTF && correctTF === studentTF) {
              obtainedForQuestion += tfMarks;
            }

            // Check justify part using word overlap
            if (correctJustify && studentJustify) {
              const correctWords = correctJustify.split(/\s+/).filter(w => w.length > 2);
              const studentWords = studentJustify.split(/\s+/).filter(w => w.length > 2);

              if (correctWords.length > 0 && studentWords.length > 0) {
                let matchCount = 0;
                correctWords.forEach(word => {
                  if (studentWords.some(sw => sw.includes(word) || word.includes(sw))) {
                    matchCount++;
                  }
                });

                const matchRatio = matchCount / correctWords.length;
                if (matchRatio >= 0.7) {
                  obtainedForQuestion += justifyMarks;
                } else if (matchRatio >= 0.4) {
                  obtainedForQuestion += justifyMarks * 0.5;
                }
              }
            }
          } else {
            // Simple True/False without justify
            if (correctTF && studentTF && correctTF === studentTF) {
              obtainedForQuestion = correctQ.marks;
            }
          }

          correctQ.studentAnswer = (studentQ.answer || "").trim();
        } else {
          // SHORT/LONG (Subjective): Compare normalized text answers
          const correctText = normalizeAnswer(correctQ.correctAnswer);
          const studentText = normalizeAnswer(studentQ.answer || "");

          if (correctText && studentText) {
            // Check for exact match (after normalization)
            if (studentText === correctText) {
              obtainedForQuestion = correctQ.marks;
            } else {
              // Check for significant overlap (student answer contains key parts of correct answer)
              const correctWords = correctText.split(/\s+/).filter(w => w.length > 2);
              const studentWords = studentText.split(/\s+/).filter(w => w.length > 2);

              if (correctWords.length > 0) {
                let matchCount = 0;
                correctWords.forEach(word => {
                  if (studentWords.some(sw => sw.includes(word) || word.includes(sw))) {
                    matchCount++;
                  }
                });

                const matchRatio = matchCount / correctWords.length;
                if (matchRatio >= 0.8) {
                  obtainedForQuestion = correctQ.marks; // Full marks for 80%+ match
                } else if (matchRatio >= 0.5) {
                  obtainedForQuestion = correctQ.marks * 0.5; // Half marks for 50%+ match
                }
              }
            }
          }

          correctQ.studentAnswer = (studentQ.answer || "").trim();
        }

        // Round to 2 decimal places
        obtainedForQuestion = Math.round(obtainedForQuestion * 100) / 100;

        correctQ.obtained = obtainedForQuestion;
        correctQ.isCorrect = obtainedForQuestion > 0;
        correctQ.isFullMarks = obtainedForQuestion === correctQ.marks;
        correctQ.isPartial = obtainedForQuestion > 0 && obtainedForQuestion < correctQ.marks;
        obtainedMarks += obtainedForQuestion;

        // Count question types
        if (obtainedForQuestion === correctQ.marks) fullCorrect++;
        else if (obtainedForQuestion > 0) partialCorrect++;
        else wrong++;
      }

      // Round total obtained marks
      obtainedMarks = Math.round(obtainedMarks * 100) / 100;
      const percentage = totalMarks > 0 ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : 0;

      // Determine grade
      let grade = 'F';
      if (percentage >= 90) grade = 'A+';
      else if (percentage >= 80) grade = 'A';
      else if (percentage >= 70) grade = 'B+';
      else if (percentage >= 60) grade = 'B';
      else if (percentage >= 50) grade = 'C';
      else if (percentage >= 40) grade = 'D';

      // Save result with enhanced data
      const result = await Result.findOneAndUpdate(
        { paper: paperId, enrollmentNumber: studentResponse.enrollmentNumber },
        {
          paper: paperId,
          subject: paper.subject._id,
          enrollmentNumber: studentResponse.enrollmentNumber,
          totalMarks,
          obtainedMarks,
          percentage,
          grade,
          questionStats,
          summary: {
            totalQuestions: questionStats.length,
            fullCorrect,
            partialCorrect,
            wrong,
            attempted: questionStats.filter(q => q.studentAnswer).length
          },
          evaluatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      allResults.push(result);
    }

    // Calculate class statistics
    const classStats = {
      totalStudents: allResults.length,
      averagePercentage: (allResults.reduce((sum, r) => sum + r.percentage, 0) / allResults.length).toFixed(2),
      highestScore: Math.max(...allResults.map(r => r.percentage)),
      lowestScore: Math.min(...allResults.map(r => r.percentage)),
      passCount: allResults.filter(r => r.percentage >= 40).length,
      passRate: ((allResults.filter(r => r.percentage >= 40).length / allResults.length) * 100).toFixed(2)
    };

    // Update question difficulty in QuestionBank
    await updateQuestionDifficulty(paper.subject._id, answerKey, allResults);

    // Calculate question-wise difficulty for response using μ/σ-based zones
    // Step 1: Collect accuracy data for all questions
    const questionData = answerKey.map((q, i) => {
      let correct = 0, partial = 0, wrong = 0;
      allResults.forEach(r => {
        if (r.questionStats && r.questionStats[i]) {
          if (r.questionStats[i].isFullMarks) correct++;
          else if (r.questionStats[i].isPartial || r.questionStats[i].obtained > 0) partial++;
          else wrong++;
        }
      });
      const accuracy = (correct / allResults.length) * 100;
      return { questionNumber: i + 1, questionText: q.questionText, correct, partial, wrong, accuracy };
    });

    // Step 2: Calculate Mean (μ) and Standard Deviation (σ)
    const accuracies = questionData.map(q => q.accuracy);
    const mean = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
    const variance = accuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / accuracies.length;
    const stdDev = Math.sqrt(variance);

    // Step 3: Classify using Normal Distribution Zones
    // Easy: x ≥ μ (top 50%), Medium: μ - σ ≤ x < μ (~34.1%), Hard: x < μ - σ (bottom ~15.9%)
    const questionDifficulty = questionData.map(q => ({
      ...q,
      accuracy: Math.round(q.accuracy * 100) / 100,
      difficulty: q.accuracy >= mean ? 'Easy' : q.accuracy >= (mean - stdDev) ? 'Medium' : 'Hard'
    }));

    // Sort results by percentage (descending) for proper ranking
    allResults.sort((a, b) => b.percentage - a.percentage);

    res.status(200).json({
      success: true,
      message: `Evaluated ${allResults.length} students`,
      paperName: paper.paperName,
      subjectName: paper.subject.name,
      totalMarks: paper.totalMarks,
      classStats,
      questionDifficulty,
      results: allResults,
      analytics: {
        averageScore: Number(classStats.averagePercentage),
        highestScore: classStats.highestScore,
        lowestScore: classStats.lowestScore,
        passRate: Number(classStats.passRate)
      }
    });
  } catch (error) {
    console.error("Evaluation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Helper function to update question difficulty in QuestionBank using μ/σ-based zones
async function updateQuestionDifficulty(subjectId, answerKey, allResults) {
  try {
    const questionBank = await QuestionBank.findOne({ subject: subjectId });
    if (!questionBank) return;

    const normalizeText = (text) =>
      text.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

    const totalStudents = allResults.length;
    if (totalStudents === 0) return;

    // Step 1: Collect accuracy data for all questions
    const questionData = [];

    for (let i = 0; i < answerKey.length; i++) {
      const keyQuestion = answerKey[i];
      const normalizedKeyText = normalizeText(keyQuestion.questionText);

      const bankQuestionIndex = questionBank.questions.findIndex(
        q => normalizeText(q.questionText) === normalizedKeyText
      );

      if (bankQuestionIndex === -1) continue;

      let correctCount = 0, partialCount = 0, wrongCount = 0, totalScore = 0;

      allResults.forEach(result => {
        if (result.questionStats && result.questionStats[i]) {
          const stat = result.questionStats[i];
          if (stat.isFullMarks) correctCount++;
          else if (stat.isPartial || (stat.obtained > 0 && stat.obtained < stat.marks)) partialCount++;
          else wrongCount++;
          totalScore += stat.obtained || 0;
        }
      });

      const accuracy = (correctCount / totalStudents) * 100;
      const avgScore = totalScore / totalStudents;

      questionData.push({ bankQuestionIndex, accuracy, avgScore, correctCount, partialCount, wrongCount });
    }

    if (questionData.length === 0) return;

    // Step 2: Calculate Mean (μ) and Standard Deviation (σ)
    const accuracies = questionData.map(q => q.accuracy);
    const mean = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
    const variance = accuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / accuracies.length;
    const stdDev = Math.sqrt(variance);

    // Step 3: Classify using Normal Distribution Zones
    // Easy: x ≥ μ (top 50%), Medium: μ - σ ≤ x < μ (~34.1%), Hard: x < μ - σ (bottom ~15.9%)
    for (const qData of questionData) {
      let difficulty;
      if (qData.accuracy >= mean) difficulty = 'Easy';
      else if (qData.accuracy >= (mean - stdDev)) difficulty = 'Medium';
      else difficulty = 'Hard';

      questionBank.questions[qData.bankQuestionIndex].difficulty = difficulty;
      questionBank.questions[qData.bankQuestionIndex].difficultyStats = {
        totalAttempts: totalStudents,
        correctCount: qData.correctCount,
        partialCount: qData.partialCount,
        wrongCount: qData.wrongCount,
        accuracy: Math.round(qData.accuracy * 100) / 100,
        avgScore: Math.round(qData.avgScore * 100) / 100,
        mean: Math.round(mean * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        lastAnalyzedAt: new Date()
      };
    }

    questionBank.markModified('questions');
    await questionBank.save();
    console.log(`✅ Updated difficulty for ${questionData.length} questions (μ=${mean.toFixed(1)}%, σ=${stdDev.toFixed(1)}%)`);
  } catch (error) {
    console.error("Error updating question difficulty:", error);
  }
}

// Get results for a paper (with full analytics for persistence)
export const getPaperResults = async (req, res) => {
  try {
    const { paperId } = req.params;

    const paper = await Paper.findById(paperId).populate("subject", "name");
    if (!paper) {
      return res.status(404).json({ success: false, message: "Paper not found" });
    }

    const results = await Result.find({ paper: paperId })
      .sort({ percentage: -1 });

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        results: [],
        classStats: null,
        questionDifficulty: [],
        paperName: paper.paperName,
        subjectName: paper.subject?.name || ''
      });
    }

    // Calculate class statistics
    const classStats = {
      totalStudents: results.length,
      averageScore: Number((results.reduce((sum, r) => sum + r.percentage, 0) / results.length).toFixed(2)),
      highestScore: Math.max(...results.map(r => r.percentage)),
      lowestScore: Math.min(...results.map(r => r.percentage)),
      passCount: results.filter(r => r.percentage >= 40).length,
      passRate: Number(((results.filter(r => r.percentage >= 40).length / results.length) * 100).toFixed(2))
    };

    // Calculate question difficulty from results using μ/σ-based zones
    const answerKey = paper.key?.questions || [];

    // Step 1: Collect accuracy data for all questions
    const questionData = answerKey.map((q, i) => {
      let correct = 0, partial = 0, wrong = 0;

      results.forEach(r => {
        if (r.questionStats && r.questionStats[i]) {
          const stat = r.questionStats[i];
          if (stat.isFullMarks) correct++;
          else if (stat.isPartial || (stat.obtained > 0 && stat.obtained < stat.marks)) partial++;
          else wrong++;
        }
      });

      const accuracy = results.length > 0 ? Math.round((correct / results.length) * 10000) / 100 : 0;
      return { questionNumber: i + 1, questionText: q.questionText || `Question ${i + 1}`, correct, partial, wrong, accuracy };
    });

    // Step 2: Calculate Mean (μ) and Standard Deviation (σ)
    const accuracies = questionData.map(q => q.accuracy);
    const mean = accuracies.length > 0 ? accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length : 0;
    const variance = accuracies.length > 0 ? accuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / accuracies.length : 0;
    const stdDev = Math.sqrt(variance);

    // Step 3: Classify using Normal Distribution Zones
    // Easy: x ≥ μ (top 50%), Medium: μ - σ ≤ x < μ (~34.1%), Hard: x < μ - σ (bottom ~15.9%)
    const questionDifficulty = questionData.map(q => ({
      ...q,
      difficulty: q.accuracy >= mean ? 'Easy' : q.accuracy >= (mean - stdDev) ? 'Medium' : 'Hard'
    }));

    res.status(200).json({
      success: true,
      results,
      classStats,
      questionDifficulty,
      paperName: paper.paperName,
      subjectName: paper.subject?.name || '',
      analytics: {
        averageScore: classStats.averageScore,
        highestScore: classStats.highestScore,
        lowestScore: classStats.lowestScore,
        passRate: classStats.passRate
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== QUESTION BANK ====================

// Helper function to add questions to question bank
async function addQuestionsToBank(subjectId, subjectName, questions, paperId, fileName) {
  try {
    let questionBank = await QuestionBank.findOne({ subject: subjectId });

    if (!questionBank) {
      questionBank = new QuestionBank({
        subject: subjectId,
        subjectName: subjectName,
        questions: []
      });
    }

    // Normalization for duplicate detection
    const normalizeText = (text) =>
      text.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

    for (const q of questions) {
      const normalizedQuestion = normalizeText(q.questionText);

      // Check if question already exists
      const existingIndex = questionBank.questions.findIndex(
        existing => normalizeText(existing.questionText) === normalizedQuestion
      );

      if (existingIndex >= 0) {
        // Increment frequency and add source
        questionBank.questions[existingIndex].frequency += 1;
        if (!questionBank.questions[existingIndex].sourceFiles.includes(fileName)) {
          questionBank.questions[existingIndex].sourceFiles.push(fileName);
        }
        if (!questionBank.questions[existingIndex].sourcePapers.includes(paperId)) {
          questionBank.questions[existingIndex].sourcePapers.push(paperId);
        }
      } else {
        // Add new question
        questionBank.questions.push({
          questionText: q.questionText,
          questionType: q.questionType,
          marks: q.marks,
          options: q.options,
          answer: q.answer,
          frequency: 1,
          sourceFiles: [fileName],
          sourcePapers: [paperId],
          addedAt: new Date()
        });
      }
    }

    await questionBank.save();

    // Update subject's total questions
    await Subject.findByIdAndUpdate(subjectId, { totalQuestions: questionBank.totalQuestions });

    return questionBank;
  } catch (error) {
    console.error("Error adding to question bank:", error);
    throw error;
  }
}

// Get question bank for a subject
export const getSubjectQuestionBank = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const questionBank = await QuestionBank.findOne({ subject: subjectId })
      .populate("questions.sourcePapers", "paperName paperNumber");

    if (!questionBank) {
      return res.status(404).json({ success: false, message: "Question bank not found for this subject" });
    }

    res.status(200).json({
      success: true,
      questionBank
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all question banks
export const getAllQuestionBanks = async (req, res) => {
  try {
    const questionBanks = await QuestionBank.find()
      .populate("subject", "name code description")
      .sort({ subjectName: 1 });

    res.status(200).json({
      success: true,
      questionBanks
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== DIFFICULTY ANALYSIS ====================

// Get difficulty analysis for a paper
export const getPaperDifficultyAnalysis = async (req, res) => {
  try {
    const { paperId } = req.params;

    const results = await Result.find({ paper: paperId });

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: "No results found for analysis" });
    }

    const paper = await Paper.findById(paperId);
    const totalQuestions = paper.key?.questions?.length || 0;

    // Calculate question-wise stats using μ/σ-based zones
    // Step 1: Collect accuracy data for all questions
    const questionData = [];

    for (let i = 0; i < totalQuestions; i++) {
      let correctCount = 0;
      let totalAttempts = results.length;

      results.forEach(result => {
        if (result.questionStats[i]?.isCorrect) {
          correctCount++;
        }
      });

      const accuracy = totalAttempts > 0 ? (correctCount / totalAttempts) * 100 : 0;
      questionData.push({
        questionNumber: i + 1,
        questionText: paper.key.questions[i]?.questionText || "",
        totalAttempts,
        correctCount,
        wrongCount: totalAttempts - correctCount,
        accuracy
      });
    }

    // Step 2: Calculate Mean (μ) and Standard Deviation (σ)
    const accuracies = questionData.map(q => q.accuracy);
    const mean = accuracies.length > 0 ? accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length : 0;
    const variance = accuracies.length > 0 ? accuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / accuracies.length : 0;
    const stdDev = Math.sqrt(variance);

    // Step 3: Classify using Normal Distribution Zones
    // Easy: x ≥ μ (top 50%), Medium: μ - σ ≤ x < μ (~34.1%), Hard: x < μ - σ (bottom ~15.9%)
    const questionAnalysis = questionData.map(q => ({
      ...q,
      accuracy: q.accuracy.toFixed(2),
      difficulty: q.accuracy >= mean ? "Easy" : q.accuracy >= (mean - stdDev) ? "Medium" : "Hard"
    }));

    // Calculate overall stats
    const avgAccuracy = questionData.reduce((sum, q) => sum + q.accuracy, 0) / totalQuestions;
    const easyCount = questionAnalysis.filter(q => q.difficulty === "Easy").length;
    const mediumCount = questionAnalysis.filter(q => q.difficulty === "Medium").length;
    const hardCount = questionAnalysis.filter(q => q.difficulty === "Hard").length;

    res.status(200).json({
      success: true,
      analysis: {
        totalStudents: results.length,
        totalQuestions,
        averageAccuracy: avgAccuracy.toFixed(2),
        difficultyDistribution: {
          easy: easyCount,
          medium: mediumCount,
          hard: hardCount
        },
        questions: questionAnalysis
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete all questions from a subject's question bank
export const deleteAllQuestions = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const questionBank = await QuestionBank.findOne({ subject: subjectId });
    if (!questionBank) {
      return res.status(404).json({ success: false, message: "Question bank not found" });
    }

    const deletedCount = questionBank.questions.length;
    questionBank.questions = [];
    await questionBank.save();

    // Update subject's total questions count
    await Subject.findByIdAndUpdate(subjectId, { totalQuestions: 0 });

    res.status(200).json({
      success: true,
      message: `Deleted all ${deletedCount} questions from question bank`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
