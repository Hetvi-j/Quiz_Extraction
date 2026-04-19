import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import QuestionBank from "../models/QuestionBank.js";
import Subject from "../models/Subject.js";
import Paper from "../models/Paper.js";
import Result from "../models/Result.js";
import {
  roundToHalf as roundMarksToHalf,
  gradeMcqAnswer,
  fastGradeShortText,
  gradeTrueFalseAnswer,
  sanitizeMcqAnswer,
  shouldRetryExtraction
} from "../utils/evaluationHelpers.js";

// Free OCR Service URL (Python service running on port 8001)
const FREE_OCR_SERVICE_URL = process.env.FREE_OCR_SERVICE_URL || "http://localhost:8001";

/**
 * Round a number to the nearest 0.5 increment
 */
const roundToHalf = (value) => Math.round(value * 2) / 2;

// ==================== GRADING HELPER FUNCTIONS ====================

/**
 * Extract only the leading numeric value from a string.
 * e.g. "23dB" -> 23, "18.4%" -> 18.4, "16 dB gain" -> 16
 * Returns null if no number found.
 */
const extractNumeric = (s) => {
  if (!s) return null;
  const m = String(s).trim().match(/^([-+]?\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
};

/**
 * Returns true if a string is primarily numeric (number + optional unit).
 * e.g. "23dB" -> true, "18.4%" -> true, "Request to send" -> false
 */
const isPrimarilyNumeric = (s) => {
  if (!s) return false;
  const num = extractNumeric(s);
  if (num === null) return false;
  // After the number, only allow whitespace + unit chars (letters, %, etc.)
  const remainder = String(s).trim().replace(/^[-+]?\d+\.?\d*/, "").trim();
  // If remainder has more than 2 words, it's text not a unit
  return remainder.split(/\s+/).filter(Boolean).length <= 2;
};

/**
 * Clean and normalize text for comparison.
 */
const cleanText = (text) => {
  if (!text) return "";
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
};

/**
 * FIX Q9: Compare two values numerically, allowing different units.
 * "23dB" == "23", "18.4%" == "18.4", "16 dB" == "16 dB gain"
 */
const isNumericallyEqual = (a, b) => {
  const na = extractNumeric(a);
  const nb = extractNumeric(b);
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) < 0.0001;
};

/**
 * Check if two numbers are within a percentage tolerance (default 5%).
 * Handles rounding differences: 16.35 ≈ 16, 23.1 ≈ 23
 */
const isNumericallyClose = (a, b, tolerancePercent = 5.0) => {
  const na = extractNumeric(a);
  const nb = extractNumeric(b);
  if (na === null || nb === null) return false;
  if (nb === 0) return na === 0;
  const percentDiff = Math.abs(na - nb) / Math.abs(nb) * 100;
  return percentDiff <= tolerancePercent;
};

/**
 * Semantic containment match for technical terms.
 * "1-persistent CSMA" contains "1-persistent" → MATCH
 * Student answer containing the key term = correct.
 */
const semanticContainsMatch = (studentAnswer, keyAnswer) => {
  if (!studentAnswer || !keyAnswer) return false;
  const s = cleanText(studentAnswer);
  const k = cleanText(keyAnswer);

  // Exact match
  if (s === k) return true;

  // Key is contained in student answer (student added extra words)
  if (s.includes(k)) return true;

  // Student answer is contained in key (abbreviated but correct)
  if (k.includes(s) && s.length >= 3) return true;

  // Handle hyphen variations: "1-persistent" vs "1 persistent"
  const sDehyphen = s.replace(/-/g, " ").replace(/\s+/g, " ");
  const kDehyphen = k.replace(/-/g, " ").replace(/\s+/g, " ");
  if (sDehyphen === kDehyphen) return true;
  if (sDehyphen.includes(kDehyphen)) return true;

  return false;
};

/**
 * FIX Q6: Compare comma-separated values where both sides may have units/%.
 * "18.4%, 36.8%" should match "18.4, 36.8"
 * Each part is compared numerically if numeric, or exactly if text.
 */
const multiValueMatch = (student, key) => {
  const splitClean = (s) => s.split(",").map(p => p.trim()).filter(Boolean);
  const sParts = splitClean(student);
  const kParts = splitClean(key);

  if (sParts.length !== kParts.length) return false;

  return sParts.every((s, i) => {
    const k = kParts[i];
    const sc = cleanText(s);
    const kc = cleanText(k);
    if (sc === kc) return true;
    // Both numeric → compare numbers (handles %)
    if (isPrimarilyNumeric(s) && isPrimarilyNumeric(k)) {
      return isNumericallyEqual(s, k);
    }
    // Text → exact match only
    return false;
  });
};

/**
 * FIX Q8 & Q14: Grade FILL_BLANK answers with semantic matching.
 * - Numeric: use numeric comparison with 5% tolerance
 * - Text: use semantic containment (student answer contains key term = correct)
 * Returns { obtained, feedback }
 */
const gradeFillBlank = (keyAnswer, studentAnswer, marks) => {
  const sc = cleanText(studentAnswer);
  const kc = cleanText(keyAnswer);

  if (!sc) return { obtained: 0, feedback: "No answer provided." };

  // 1. Exact match
  if (sc === kc) return { obtained: marks, feedback: "Correct." };

  // 2. Multi-value (comma-separated)
  const hasComma = kc.includes(",");
  if (hasComma) {
    if (multiValueMatch(sc, kc)) {
      return { obtained: marks, feedback: "Correct values." };
    }
    return {
      obtained: 0,
      feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".`
    };
  }

  // 3. Numeric comparison (exact)
  if (isPrimarilyNumeric(kc)) {
    if (isNumericallyEqual(sc, kc)) {
      return { obtained: marks, feedback: "Correct numerical value." };
    }
    // 4. Numeric with 5% tolerance (handles rounding: 16.35 ≈ 16)
    if (isNumericallyClose(sc, kc, 5.0)) {
      return { obtained: marks, feedback: "Correct value (within tolerance)." };
    }
    return {
      obtained: 0,
      feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".`
    };
  }

  // 5. Semantic containment match for technical terms
  // "1-persistent CSMA" contains "1-persistent" → CORRECT
  if (semanticContainsMatch(studentAnswer, keyAnswer)) {
    return { obtained: marks, feedback: "Correct - key term found." };
  }

  // 6. Word boundary match for short terms
  const keyWords = kc.split(/\s+/);
  const isShortTerm = keyWords.length <= 3;

  if (isShortTerm) {
    const escaped = kc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = new RegExp(`\\b${escaped}\\b`, "i").test(sc);
    if (found) {
      return { obtained: marks, feedback: "Correct." };
    }
  }

  return {
    obtained: 0,
    feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".`
  };
};

// ==================== MCQ HELPERS ====================

// Stricter extraction: only accept short, MCQ-style patterns like "A", "B", "A,B", "(C)"
const extractLetters = (answer) => {
  if (!answer) return [];

  const raw = answer.toString().trim().toUpperCase();

  // If it looks like a long sentence with spaces, don't treat it as an MCQ choice
  if (raw.length > 6 && /\s/.test(raw)) return [];

  // Accept patterns like "A", "A,B", "A B", "(A)", "A,C"
  const match = raw.match(/^\(?[A-E](?:[\s,]*[A-E])*\)?$/);
  if (!match) return [];

  const letters = match[0].match(/[A-E]/g) || [];
  return [...new Set(letters)];
};

// ==================== HEALTH CHECK ====================

export const healthCheck = async (req, res) => {
  try {
    const response = await axios.get(`${FREE_OCR_SERVICE_URL}/health`, { timeout: 5000 });
    res.status(200).json({ success: true, service: "Free OCR (Groq Vision)", ...response.data });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Free OCR service is not running",
      details: "Start the service with: python Server/ocr_service_free.py",
      error: error.message
    });
  }
};

// ==================== FILE EXTRACTION ENDPOINTS ====================

export const extractFromFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    console.log(`\n========== FREE OCR EXTRACTION ==========\nFile: ${fileName}`);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);

    const response = await axios.post(`${FREE_OCR_SERVICE_URL}/ocr/extract`, formData, {
      headers: { ...formData.getHeaders() },
      timeout: 180000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    fs.unlinkSync(filePath);

    const extraction = response.data.extraction || {};
    const docInfo = extraction.documentInfo || {};

    // Check for hallucination warning from Python service
    if (docInfo._warning) {
      console.log(`\n⚠️  HALLUCINATION WARNING: ${docInfo._warning}`);
      console.log(`    Review MCQ answers carefully!\n`);
    }

    console.log(`✅ Extracted ${extraction.questions?.length || 0} questions\n==========================================\n`);

    res.status(200).json({
      success: true,
      message: "Extraction successful",
      filename: fileName,
      documentInfo: docInfo,
      questions: extraction.questions || [],
      totalQuestions: extraction.questions?.length || 0,
      warning: docInfo._warning || null
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("Free OCR extraction error:", error.message);
    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({ success: false, message: "Free OCR service is not running" });
    }
    res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

export const extractAnswerKey = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);

    const response = await axios.post(`${FREE_OCR_SERVICE_URL}/ocr/extract-key`, formData, {
      headers: formData.getHeaders(),
      timeout: 180000
    });

    fs.unlinkSync(filePath);
    const extraction = response.data.extraction || {};
    const questions = (extraction.questions || []).map((q, index) => ({
      questionNumber: index + 1,
      questionText: q.questionText || q.text || `Question ${index + 1}`,
      questionType: q.questionType || q.question_type || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.Answer || q.answer || q.student_ans || ""
    }));

    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
    res.status(200).json({
      success: true,
      message: "Answer key extracted successfully",
      filename: fileName,
      documentInfo: extraction.documentInfo || {},
      questions,
      totalQuestions: questions.length,
      totalMarks
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

export const extractStudentResponse = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const runExtraction = async (forceVoting = false) => {
      const formData = new FormData();
      formData.append("file", fs.createReadStream(filePath), fileName);
      if (req.body.question_types) {
        formData.append("question_types", req.body.question_types);
      }
      if (forceVoting) {
        formData.append("force_voting", "true");
      }

      return axios.post(`${FREE_OCR_SERVICE_URL}/ocr/extract`, formData, {
        headers: formData.getHeaders(),
        timeout: 180000
      });
    };

    let response = await runExtraction(false);

    let extraction = response.data.extraction || {};
    let docInfo = extraction.documentInfo || {};
    let enrollmentNumber = docInfo.enrollmentNumber || "0";
    if (enrollmentNumber === "0") enrollmentNumber = fileName.replace(/\.[^/.]+$/, "");

    // Check for hallucination warning from Python service
    if (docInfo._warning) {
      console.log(`\n⚠️  HALLUCINATION WARNING for ${enrollmentNumber}: ${docInfo._warning}`);
      console.log(`    MCQ answers may be from model memory, not student marks!\n`);
    }

    let answers = (extraction.questions || []).map((q, index) => ({
      questionNumber: q.questionNumber || q.q_no || index + 1,
      questionText: q.questionText || q.text || "",
      questionType: q.questionType || q.question_type || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.questionType === "MCQ" || q.question_type === "MCQ"
        ? sanitizeMcqAnswer(q.Answer || q.answer || q.student_ans || "")
        : (q.Answer || q.answer || q.student_ans || "")
    }));

    const retrySignal = shouldRetryExtraction(answers);
    let extractionRetried = false;
    if (retrySignal.retry) {
      console.log(`\n⚠️  Weak MCQ extraction for ${enrollmentNumber} (${retrySignal.emptyCount} invalid/empty, ${(retrySignal.validRatio * 100).toFixed(0)}% valid). Retrying with voting...`);
      const originalAnswersByQuestion = new Map(answers.map((answer) => [Number(answer.questionNumber), answer]));
      response = await runExtraction(true);
      extraction = response.data.extraction || {};
      docInfo = extraction.documentInfo || docInfo;
      enrollmentNumber = docInfo.enrollmentNumber || enrollmentNumber;
      answers = (extraction.questions || []).map((q, index) => {
        const questionNumber = q.questionNumber || q.q_no || index + 1;
        const questionType = q.questionType || q.question_type || "MCQ";
        const retried = {
          questionNumber,
          questionText: q.questionText || q.text || "",
          questionType,
          marks: Number(q.marks) || 1,
          options: q.options || [],
          answer: questionType === "MCQ"
            ? sanitizeMcqAnswer(q.Answer || q.answer || q.student_ans || "")
            : (q.Answer || q.answer || q.student_ans || "")
        };

        if (String(questionType).toUpperCase() !== "MCQ") {
          const original = originalAnswersByQuestion.get(Number(questionNumber));
          if (original) return { ...retried, answer: original.answer };
        }

        return retried;
      });
      extractionRetried = true;
    }

    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: "Student response extracted successfully",
      filename: fileName,
      enrollmentNumber,
      documentInfo: docInfo,
      answers,
      totalAnswers: answers.length,
      warning: docInfo._warning || null,
      extractionRetried
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

export const saveKeyData = async (req, res) => {
  try {
    const { paperId } = req.params;
    const { questions, documentInfo, totalMarks, fileName } = req.body;

    const paper = await Paper.findById(paperId).populate("subject");
    if (!paper) return res.status(404).json({ success: false, message: "Paper not found" });

    const formattedQuestions = (questions || []).map(q => ({
      questionText: q.questionText,
      questionType: q.questionType || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.answer || q.Answer || ""
    }));

    const calculatedTotalMarks = totalMarks || formattedQuestions.reduce((sum, q) => sum + q.marks, 0);
    paper.key = { fileName: fileName || "groq_extracted", questions: formattedQuestions, uploadedAt: new Date() };
    paper.totalMarks = calculatedTotalMarks;
    await paper.save();

    await addQuestionsToBank(paper.subject._id, paper.subject.name, formattedQuestions, paper._id, fileName);

    res.status(200).json({
      success: true,
      message: "Answer key saved successfully",
      totalQuestions: formattedQuestions.length,
      totalMarks: calculatedTotalMarks
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const saveResponseData = async (req, res) => {
  try {
    const { paperId } = req.params;
    const { enrollmentNumber, answers, fileName } = req.body;

    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ success: false, message: "Paper not found" });

    const questions = (answers || []).map((a, index) => ({
      questionNumber: a.questionNumber || index + 1,
      questionText: a.questionText || `Question ${a.questionNumber || index + 1}`,
      // Trust OCR-detected type when available; default to MCQ
      questionType: a.questionType || "MCQ",
      marks: Number(a.marks) || 1,
      options: a.options || [],
      answer: a.answer || ""
    }));

    const existingIndex = paper.studentResponses.findIndex(sr => sr.enrollmentNumber === enrollmentNumber);
    const responseData = { enrollmentNumber, fileName: fileName || "groq_extracted", questions, submittedAt: new Date() };

    if (existingIndex >= 0) {
      paper.studentResponses[existingIndex] = responseData;
    } else {
      paper.studentResponses.push(responseData);
    }

    await paper.save();
    res.status(200).json({ success: true, message: `Student response saved for ${enrollmentNumber}`, totalAnswers: questions.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const evaluateSubjectiveAnswers = async (req, res) => {
  try {
    const { questions } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: "No questions provided for evaluation" });
    }

    const formattedQuestions = questions.map((q, index) => ({
      question_number: q.questionNumber || index + 1,
      question_text: q.questionText || `Question ${index + 1}`,
      answer_key: q.answerKey || q.answer_key || "",
      student_answer: q.studentAnswer || q.student_answer || "",
      max_marks: Number(q.maxMarks || q.max_marks || q.marks) || 1
    }));

    const response = await axios.post(
      `${FREE_OCR_SERVICE_URL}/evaluate/subjective`,
      { questions: formattedQuestions },
      { headers: { "Content-Type": "application/json" }, timeout: 120000 }
    );

    res.status(200).json({
      success: true,
      message: "Subjective evaluation completed",
      totalMarks: response.data.total_marks,
      obtainedMarks: response.data.obtained_marks,
      percentage: response.data.percentage,
      results: response.data.results
    });
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({ success: false, message: "Free OCR service is not running" });
    }
    res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

// ==================== MAIN EVALUATION FUNCTION ====================

export const evaluateSubjectivePaper = async (req, res) => {
  try {
    const { paperId } = req.params;

    const Paper = (await import("../models/Paper.js")).default;
    const Result = (await import("../models/Result.js")).default;

    const paper = await Paper.findById(paperId).populate("subject");
    if (!paper) return res.status(404).json({ success: false, message: "Paper not found" });
    if (!paper.key?.questions?.length) return res.status(400).json({ success: false, message: "Answer key not uploaded" });
    if (!paper.studentResponses.length) return res.status(400).json({ success: false, message: "No student responses found" });

    console.log(`\n========== SUBJECTIVE PAPER EVALUATION ==========`);
    console.log(`Paper: ${paper.paperName} | Students: ${paper.studentResponses.length} | Questions: ${paper.key.questions.length}`);

    const answerKey = paper.key.questions;
    const allResults = [];

    await addQuestionsToBank(paper.subject._id, paper.subject.name, answerKey, paper._id, paper.key.fileName || "groq_extracted");

    for (const studentResponse of paper.studentResponses) {
      console.log(`\n📝 Evaluating: ${studentResponse.enrollmentNumber}`);

      // Collect questions that need LLM evaluation (SHORT/LONG only)
      const questionsForLLM = [];
      const questionStats = [];

      // Build a map of student answers by questionNumber to avoid index-shift errors
      const studentQuestionsByNumber = new Map();
      (studentResponse.questions || []).forEach((q, idx) => {
        const qNum = q.questionNumber || idx + 1;
        if (!studentQuestionsByNumber.has(qNum)) {
          studentQuestionsByNumber.set(qNum, q);
        }
      });

      for (let i = 0; i < answerKey.length; i++) {
        const keyQ = answerKey[i];
        const questionNumber = keyQ.questionNumber || i + 1;
        const studentQ = studentQuestionsByNumber.get(questionNumber) || studentResponse.questions[i] || {};
        const questionType = (keyQ.questionType || "MCQ").toUpperCase();
        const marks = Number(keyQ.marks) || 1;
        const keyAnswer = keyQ.answer || "";
        const studentAnswer = studentQ.answer || "";

        // ── FILL_BLANK ─────────────────────────────────────────────────────
        // FIX: FILL_BLANK was falling into MCQ letter extraction → all wrong
        // Now handled with proper numeric/text comparison
        if (questionType === "FILL_BLANK") {
          const fastResult = fastGradeShortText(keyAnswer, studentAnswer, marks);
          if (fastResult.resolved) {
            const roundedObtained = roundMarksToHalf(fastResult.obtained);
            questionStats.push({
              questionNumber,
              questionText: keyQ.questionText,
              questionType,
              correctAnswer: keyAnswer,
              studentAnswer,
              marks,
              obtained: roundedObtained,
              isCorrect: roundedObtained > 0,
              isFullMarks: roundedObtained === marks,
              isPartial: roundedObtained > 0 && roundedObtained < marks,
              feedback: fastResult.feedback
            });
          } else {
            questionsForLLM.push({
              question_number: questionNumber,
              question_text: keyQ.questionText,
              answer_key: keyAnswer,
              student_answer: studentAnswer,
              max_marks: marks,
              question_type: "SHORT"
            });
            questionStats.push({
              questionNumber,
              questionText: keyQ.questionText,
              questionType,
              correctAnswer: keyAnswer,
              studentAnswer,
              marks,
              obtained: 0,
              isCorrect: false,
              isFullMarks: false,
              isPartial: false,
              feedback: "",
              correctPoints: [],
              missingPoints: []
            });
          }
          continue;
        }

        // ── SHORT / LONG → send to Python LLM ──────────────────────────────
        if (questionType === "SHORT" || questionType === "LONG") {
          if (questionType === "SHORT") {
            const fastResult = fastGradeShortText(keyAnswer, studentAnswer, marks);
            if (fastResult.resolved) {
              const roundedObtained = roundMarksToHalf(fastResult.obtained);
              questionStats.push({
                questionNumber,
                questionText: keyQ.questionText,
                questionType,
                correctAnswer: keyAnswer,
                studentAnswer,
                marks,
                obtained: roundedObtained,
                isCorrect: roundedObtained > 0,
                isFullMarks: roundedObtained === marks,
                isPartial: roundedObtained > 0 && roundedObtained < marks,
                feedback: fastResult.feedback,
                correctPoints: [],
                missingPoints: []
              });
              continue;
            }
          }

          questionsForLLM.push({
            question_number: questionNumber,
            question_text: keyQ.questionText,
            answer_key: keyAnswer,
            student_answer: studentAnswer,
            max_marks: marks,
            question_type: questionType
          });

          // Placeholder - will be updated after LLM response
          questionStats.push({
            questionNumber,
            questionText: keyQ.questionText,
            questionType,
            correctAnswer: keyAnswer,
            studentAnswer,
            marks,
            obtained: 0,
            isCorrect: false,
            isFullMarks: false,
            isPartial: false,
            feedback: "",
            correctPoints: [],
            missingPoints: []
          });
          continue;
        }

        // ── TRUE_FALSE ──────────────────────────────────────────────────────
        if (questionType === "TRUE_FALSE") {
          const tfResult = gradeTrueFalseAnswer(keyAnswer, studentAnswer, marks);
          const obtainedForQuestion = roundMarksToHalf(tfResult.obtained);
          questionStats.push({
            questionNumber,
            questionText: keyQ.questionText,
            questionType,
            correctAnswer: keyAnswer,
            studentAnswer,
            marks,
            obtained: obtainedForQuestion,
            isCorrect: obtainedForQuestion > 0,
            isFullMarks: obtainedForQuestion === marks,
            isPartial: obtainedForQuestion > 0 && obtainedForQuestion < marks,
            feedback: tfResult.feedback
          });
          continue;
        }

        // ── MCQ (default) ───────────────────────────────────────────────────
        {
          const mcqResult = gradeMcqAnswer(keyAnswer, studentAnswer, marks);
          const obtainedForQuestion = roundMarksToHalf(mcqResult.obtained);
          questionStats.push({
            questionNumber,
            questionText: keyQ.questionText,
            questionType,
            correctAnswer: keyAnswer,
            studentAnswer: mcqResult.normalizedStudentAnswer || studentAnswer,
            marks,
            obtained: obtainedForQuestion,
            isCorrect: obtainedForQuestion > 0,
            isFullMarks: obtainedForQuestion === marks,
            isPartial: obtainedForQuestion > 0 && obtainedForQuestion < marks,
            feedback: mcqResult.feedback
          });
        }
      }

      // ── LLM evaluation for SHORT/LONG questions ─────────────────────────
      if (questionsForLLM.length > 0) {
        try {
          const evalResponse = await axios.post(
            `${FREE_OCR_SERVICE_URL}/evaluate/subjective`,
            { questions: questionsForLLM },
            { headers: { "Content-Type": "application/json" }, timeout: 180000 }
          );

          const evalResults = evalResponse.data.results || [];
          for (const evalResult of evalResults) {
            const statIndex = questionStats.findIndex(s => s.questionNumber === evalResult.question_number);
            if (statIndex !== -1) {
              questionStats[statIndex].obtained = evalResult.obtained_marks;
              questionStats[statIndex].isCorrect = evalResult.obtained_marks > 0;
              questionStats[statIndex].isFullMarks = evalResult.obtained_marks === questionStats[statIndex].marks;
              questionStats[statIndex].isPartial = evalResult.obtained_marks > 0 && evalResult.obtained_marks < questionStats[statIndex].marks;
              questionStats[statIndex].feedback = evalResult.feedback;
              questionStats[statIndex].correctPoints = evalResult.correct_points || [];
              questionStats[statIndex].missingPoints = evalResult.missing_points || [];
            }
          }
        } catch (evalError) {
          console.error(`LLM evaluation error for ${studentResponse.enrollmentNumber}:`, evalError.message);
        }
      }

      // ── Totals & grade ───────────────────────────────────────────────────
      const totalMarks = paper.totalMarks || questionStats.reduce((sum, q) => sum + q.marks, 0);
      const obtainedMarks = roundToHalf(questionStats.reduce((sum, q) => sum + q.obtained, 0));
      const percentage = totalMarks > 0 ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : 0;

      let grade = 'F';
      if (percentage >= 90) grade = 'A+';
      else if (percentage >= 80) grade = 'A';
      else if (percentage >= 70) grade = 'B+';
      else if (percentage >= 60) grade = 'B';
      else if (percentage >= 50) grade = 'C';
      else if (percentage >= 40) grade = 'D';

      const fullCorrect = questionStats.filter(q => q.isFullMarks).length;
      const partialCorrect = questionStats.filter(q => q.isPartial).length;
      const wrong = questionStats.filter(q => !q.isCorrect).length;

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
      console.log(`   ✅ ${studentResponse.enrollmentNumber}: ${obtainedMarks}/${totalMarks} (${percentage}%)`);
    }

    // Class statistics
    const classStats = {
      totalStudents: allResults.length,
      averagePercentage: (allResults.reduce((sum, r) => sum + r.percentage, 0) / allResults.length).toFixed(2),
      highestScore: Math.max(...allResults.map(r => r.percentage)),
      lowestScore: Math.min(...allResults.map(r => r.percentage)),
      passCount: allResults.filter(r => r.percentage >= 40).length,
      passRate: ((allResults.filter(r => r.percentage >= 40).length / allResults.length) * 100).toFixed(2)
    };

    allResults.sort((a, b) => b.percentage - a.percentage);
    await updateQuestionDifficulty(paper.subject._id, answerKey, allResults);

    console.log(`\n==========================================`);
    console.log(`✅ Evaluated ${allResults.length} students | Avg: ${classStats.averagePercentage}% | Pass Rate: ${classStats.passRate}%`);
    console.log(`==========================================\n`);

    res.status(200).json({
      success: true,
      message: `Evaluated ${allResults.length} students (with subjective)`,
      paperName: paper.paperName,
      subjectName: paper.subject.name,
      totalMarks: paper.totalMarks,
      classStats,
      results: allResults
    });

  } catch (error) {
    console.error("Subjective paper evaluation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HELPER FUNCTIONS ====================

async function updateQuestionDifficulty(subjectId, answerKey, allResults) {
  try {
    const questionBank = await QuestionBank.findOne({ subject: subjectId });
    if (!questionBank) return;

    const normalizeText = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
    const totalStudents = allResults.length;
    if (!totalStudents) return;

    // ── STEP 1: Collect accuracy data for all questions ─────────────────────
    const questionData = [];

    for (let i = 0; i < answerKey.length; i++) {
      const keyQuestion = answerKey[i];
      const normalizedKeyText = normalizeText(keyQuestion.questionText || "");

      let bankQuestionIndex = questionBank.questions.findIndex(
        q => normalizeText(q.questionText || "") === normalizedKeyText
      );
      if (bankQuestionIndex === -1 && normalizedKeyText.length > 20) {
        const keyTextStart = normalizedKeyText.substring(0, 50);
        bankQuestionIndex = questionBank.questions.findIndex(
          q => normalizeText(q.questionText || "").startsWith(keyTextStart)
        );
      }
      if (bankQuestionIndex === -1) continue;

      let correctCount = 0, partialCount = 0, wrongCount = 0, totalScore = 0;

      allResults.forEach(result => {
        if (result.questionStats?.[i]) {
          const stat = result.questionStats[i];
          if (stat.isFullMarks) correctCount++;
          else if (stat.isPartial || (stat.obtained > 0 && stat.obtained < stat.marks)) partialCount++;
          else wrongCount++;
          totalScore += stat.obtained || 0;
        }
      });

      const accuracy = (correctCount / totalStudents) * 100;
      const avgScore = totalScore / totalStudents;

      questionData.push({
        index: i,
        bankQuestionIndex,
        accuracy,
        avgScore,
        correctCount,
        partialCount,
        wrongCount
      });
    }

    if (questionData.length === 0) return;

    // ── STEP 2: Calculate Mean (μ) and Standard Deviation (σ) ───────────────
    const accuracies = questionData.map(q => q.accuracy);
    const mean = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;

    const squaredDiffs = accuracies.map(acc => Math.pow(acc - mean, 2));
    const variance = squaredDiffs.reduce((sum, sq) => sum + sq, 0) / accuracies.length;
    const stdDev = Math.sqrt(variance);

    console.log(`📊 Difficulty Stats: μ = ${mean.toFixed(2)}%, σ = ${stdDev.toFixed(2)}%`);

    // ── STEP 3: Classify difficulty using Normal Distribution Zones ─────────
    // Easy Zone:   x ≥ μ         (top 50% - above or equal to mean)
    // Medium Zone: μ - σ ≤ x < μ (middle ~34.1% - between mean-1σ and mean)
    // Hard Zone:   x < μ - σ     (bottom ~15.9% - below mean-1σ)

    let matchedCount = 0;
    for (const qData of questionData) {
      matchedCount++;

      let difficulty;
      if (qData.accuracy >= mean) {
        difficulty = 'Easy';       // x ≥ μ (top 50%)
      } else if (qData.accuracy >= (mean - stdDev)) {
        difficulty = 'Medium';     // μ - σ ≤ x < μ (~34.1%)
      } else {
        difficulty = 'Hard';       // x < μ - σ (bottom ~15.9%)
      }

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
    console.log(`✅ Updated difficulty for ${matchedCount}/${answerKey.length} questions (μ=${mean.toFixed(1)}%, σ=${stdDev.toFixed(1)}%)`);
  } catch (error) {
    console.error("Error updating question difficulty:", error);
  }
}

async function addQuestionsToBank(subjectId, subjectName, questions, paperId, fileName) {
  try {
    let questionBank = await QuestionBank.findOne({ subject: subjectId });
    if (!questionBank) {
      questionBank = new QuestionBank({ subject: subjectId, subjectName, questions: [] });
    }

    const normalizeText = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
    let addedCount = 0, updatedCount = 0;

    for (const q of questions) {
      const normalizedQuestion = normalizeText(q.questionText || "");
      if (!normalizedQuestion) continue;

      const existingIndex = questionBank.questions.findIndex(
        existing => normalizeText(existing.questionText || "") === normalizedQuestion
      );

      if (existingIndex >= 0) {
        questionBank.questions[existingIndex].frequency += 1;
        if (fileName && !questionBank.questions[existingIndex].sourceFiles.includes(fileName))
          questionBank.questions[existingIndex].sourceFiles.push(fileName);
        if (paperId && !questionBank.questions[existingIndex].sourcePapers.includes(paperId))
          questionBank.questions[existingIndex].sourcePapers.push(paperId);
        updatedCount++;
      } else {
        questionBank.questions.push({
          questionText: q.questionText,
          questionType: q.questionType || "MCQ",
          marks: Number(q.marks) || 1,
          options: q.options || [],
          answer: q.answer || "",
          frequency: 1,
          sourceFiles: fileName ? [fileName] : [],
          sourcePapers: paperId ? [paperId] : [],
          addedAt: new Date(),
          difficulty: 'Not Analyzed',
          difficultyStats: {
            totalAttempts: 0, correctCount: 0, partialCount: 0,
            wrongCount: 0, accuracy: 0, avgScore: 0, lastAnalyzedAt: null
          }
        });
        addedCount++;
      }
    }

    await questionBank.save();
    await Subject.findByIdAndUpdate(subjectId, { totalQuestions: questionBank.totalQuestions });
    console.log(`📚 QuestionBank: Added ${addedCount} new, updated ${updatedCount} existing (Total: ${questionBank.totalQuestions})`);
    return questionBank;
  } catch (error) {
    console.error("Error adding to question bank:", error);
    throw error;
  }
}
