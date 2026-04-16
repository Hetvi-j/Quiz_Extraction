import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import QuestionBank from "../models/QuestionBank.js";
import Subject from "../models/Subject.js";
import Paper from "../models/Paper.js";
import Result from "../models/Result.js";

// Gemini OCR Service URL (Python service running on port 8002)
const GEMINI_OCR_SERVICE_URL = process.env.GEMINI_OCR_SERVICE_URL || "http://localhost:8002";

/**
 * Round a number to the nearest 0.5 increment
 */
const roundToHalf = (value) => Math.round(value * 2) / 2;

// ==================== GRADING HELPER FUNCTIONS ====================

const extractNumeric = (s) => {
  if (!s) return null;
  const m = String(s).trim().match(/^([-+]?\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
};

const isPrimarilyNumeric = (s) => {
  if (!s) return false;
  const num = extractNumeric(s);
  if (num === null) return false;
  const remainder = String(s).trim().replace(/^[-+]?\d+\.?\d*/, "").trim();
  return remainder.split(/\s+/).filter(Boolean).length <= 2;
};

const cleanText = (text) => {
  if (!text) return "";
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
};

const isNumericallyEqual = (a, b) => {
  const na = extractNumeric(a);
  const nb = extractNumeric(b);
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) < 0.0001;
};

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
    if (isPrimarilyNumeric(s) && isPrimarilyNumeric(k)) return isNumericallyEqual(s, k);
    return false;
  });
};

const gradeFillBlank = (keyAnswer, studentAnswer, marks) => {
  const sc = cleanText(studentAnswer);
  const kc = cleanText(keyAnswer);
  if (!sc) return { obtained: 0, feedback: "No answer provided." };
  if (sc === kc) return { obtained: marks, feedback: "Correct." };

  const hasComma = kc.includes(",");
  if (hasComma) {
    if (multiValueMatch(sc, kc)) return { obtained: marks, feedback: "Correct values." };
    return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }

  if (isPrimarilyNumeric(kc)) {
    if (isNumericallyEqual(sc, kc)) return { obtained: marks, feedback: "Correct numerical value." };
    return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }

  const keyWords = kc.split(/\s+/);
  if (keyWords.length <= 3) {
    const escaped = kc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(sc)) return { obtained: marks, feedback: "Correct." };
    return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }

  return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
};

// ==================== MCQ HELPERS ====================

const extractLetters = (answer) => {
  if (!answer) return [];
  const str = answer.toString().toUpperCase();
  if (str.length <= 3) {
    const letters = str.match(/[A-E]/g) || [];
    return [...new Set(letters)];
  }
  const match = str.match(/^([A-E])[\s,\-\.\)\:]/);
  if (match) return [match[1]];
  const firstPart = str.substring(0, 10);
  const letters = firstPart.match(/[A-E]/g) || [];
  return [...new Set(letters)];
};

// ==================== HEALTH CHECK ====================

export const healthCheck = async (req, res) => {
  try {
    const response = await axios.get(`${GEMINI_OCR_SERVICE_URL}/health`, { timeout: 5000 });
    res.status(200).json({
      success: true,
      service: "Gemini OCR (Google Gemini 2.5 Flash)",
      ...response.data
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Gemini OCR service is not running",
      details: "Start the service with: python Server/ocr_service_gemini.py",
      setup: "Get API key from https://aistudio.google.com/apikey and add GEMINI_API_KEY to .env",
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
    console.log(`\n========== GEMINI OCR EXTRACTION ==========\nFile: ${fileName}`);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);

    const response = await axios.post(`${GEMINI_OCR_SERVICE_URL}/ocr/extract`, formData, {
      headers: { ...formData.getHeaders() },
      timeout: 180000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    fs.unlinkSync(filePath);

    const extraction = response.data.extraction || {};
    console.log(`Extracted ${extraction.questions?.length || 0} questions\n==========================================\n`);

    res.status(200).json({
      success: true,
      message: "Extraction successful (Gemini)",
      filename: fileName,
      documentInfo: extraction.documentInfo || {},
      questions: extraction.questions || [],
      totalQuestions: extraction.questions?.length || 0
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error("Gemini OCR extraction error:", error.message);
    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({ success: false, message: "Gemini OCR service is not running. Start with: python Server/ocr_service_gemini.py" });
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

    const response = await axios.post(`${GEMINI_OCR_SERVICE_URL}/ocr/extract-key`, formData, {
      headers: formData.getHeaders(),
      timeout: 180000
    });

    fs.unlinkSync(filePath);
    const extraction = response.data.extraction || {};
    const questions = (extraction.questions || []).map((q, index) => ({
      questionNumber: q.questionNumber || index + 1,
      questionText: q.questionText || `Question ${index + 1}`,
      questionType: q.questionType || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.Answer || q.answer || ""
    }));

    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
    res.status(200).json({
      success: true,
      message: "Answer key extracted successfully (Gemini)",
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

    // Get question types from answer key if paperId provided
    let questionTypeMap = {};
    const paperId = req.body?.paperId || req.query?.paperId;
    if (paperId) {
      try {
        const paper = await Paper.findById(paperId).select("key.questions");
        if (paper?.key?.questions?.length) {
          paper.key.questions.forEach((q, i) => {
            const num = q.questionNumber || (i + 1);
            questionTypeMap[num] = (q.questionType || "MCQ").toUpperCase();
          });
        }
      } catch (e) {
        console.warn("Could not load answer key for question type hints:", e.message);
      }
    }

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);
    if (Object.keys(questionTypeMap).length > 0) {
      formData.append("question_types", JSON.stringify(questionTypeMap));
    }

    const response = await axios.post(`${GEMINI_OCR_SERVICE_URL}/ocr/extract`, formData, {
      headers: formData.getHeaders(),
      timeout: 180000
    });

    fs.unlinkSync(filePath);
    const extraction = response.data.extraction || {};

    let enrollmentNumber = extraction.documentInfo?.enrollmentNumber || "0";
    if (enrollmentNumber === "0") enrollmentNumber = fileName.replace(/\.[^/.]+$/, "");

    const answers = (extraction.questions || []).map((q, index) => ({
      questionNumber: q.questionNumber || index + 1,
      questionText: q.questionText || "",
      answer: q.Answer || q.answer || ""
    }));

    res.status(200).json({
      success: true,
      message: "Student response extracted successfully (Gemini)",
      filename: fileName,
      enrollmentNumber,
      documentInfo: extraction.documentInfo || {},
      answers,
      totalAnswers: answers.length
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
    paper.key = { fileName: fileName || "gemini_extracted", questions: formattedQuestions, uploadedAt: new Date() };
    paper.totalMarks = calculatedTotalMarks;
    await paper.save();

    await addQuestionsToBank(paper.subject._id, paper.subject.name, formattedQuestions, paper._id, fileName);

    res.status(200).json({
      success: true,
      message: "Answer key saved successfully (Gemini)",
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
      questionText: a.questionText || "",
      questionType: "STUDENT_RESPONSE",
      marks: 0,
      options: [],
      answer: a.answer ?? ""
    }));

    const existingIndex = paper.studentResponses.findIndex(sr => sr.enrollmentNumber === enrollmentNumber);
    const responseData = {
      enrollmentNumber,
      fileName: fileName || "gemini_extracted",
      questions,
      submittedAt: new Date()
    };

    if (existingIndex >= 0) {
      paper.studentResponses[existingIndex] = responseData;
    } else {
      paper.studentResponses.push(responseData);
    }

    await paper.save();
    res.status(200).json({
      success: true,
      message: `Student response saved for ${enrollmentNumber} (Gemini)`,
      totalAnswers: questions.length
    });
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
      max_marks: Number(q.maxMarks || q.max_marks || q.marks) || 1,
      question_type: q.questionType || "SHORT"
    }));

    const response = await axios.post(
      `${GEMINI_OCR_SERVICE_URL}/evaluate/subjective`,
      { questions: formattedQuestions },
      { headers: { "Content-Type": "application/json" }, timeout: 120000 }
    );

    res.status(200).json({
      success: true,
      message: "Subjective evaluation completed (Gemini)",
      totalMarks: response.data.total_marks,
      obtainedMarks: response.data.obtained_marks,
      percentage: response.data.percentage,
      results: response.data.results
    });
  } catch (error) {
    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({ success: false, message: "Gemini OCR service is not running" });
    }
    res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

// ==================== MAIN EVALUATION FUNCTION ====================

export const evaluateSubjectivePaper = async (req, res) => {
  try {
    const { paperId } = req.params;

    const paper = await Paper.findById(paperId).populate("subject");
    if (!paper) return res.status(404).json({ success: false, message: "Paper not found" });
    if (!paper.key?.questions?.length) return res.status(400).json({ success: false, message: "Answer key not uploaded" });
    if (!paper.studentResponses.length) return res.status(400).json({ success: false, message: "No student responses found" });

    console.log(`\n========== GEMINI PAPER EVALUATION ==========`);
    console.log(`Paper: ${paper.paperName} | Students: ${paper.studentResponses.length} | Questions: ${paper.key.questions.length}`);

    const answerKey = paper.key.questions;
    const allResults = [];

    await addQuestionsToBank(paper.subject._id, paper.subject.name, answerKey, paper._id, paper.key.fileName || "gemini_extracted");

    for (const studentResponse of paper.studentResponses) {
      console.log(`\nEvaluating: ${studentResponse.enrollmentNumber}`);

      const questionsForLLM = [];
      const questionStats = [];

      for (let i = 0; i < answerKey.length; i++) {
        const keyQ = answerKey[i];
        const studentQ = studentResponse.questions[i] || {};
        const questionType = (keyQ.questionType || "MCQ").toUpperCase();
        const marks = Number(keyQ.marks) || 1;
        const keyAnswer = keyQ.answer || "";
        const studentAnswer = studentQ.answer || "";

        // FILL_BLANK
        if (questionType === "FILL_BLANK") {
          const { obtained, feedback } = gradeFillBlank(keyAnswer, studentAnswer, marks);
          const roundedObtained = roundToHalf(obtained);
          questionStats.push({
            questionNumber: i + 1, questionText: keyQ.questionText, questionType,
            correctAnswer: keyAnswer, studentAnswer, marks,
            obtained: roundedObtained, isCorrect: roundedObtained > 0,
            isFullMarks: roundedObtained === marks, isPartial: roundedObtained > 0 && roundedObtained < marks,
            feedback
          });
          continue;
        }

        // SHORT / LONG -> send to Gemini LLM
        if (questionType === "SHORT" || questionType === "LONG") {
          questionsForLLM.push({
            question_number: i + 1, question_text: keyQ.questionText,
            answer_key: keyAnswer, student_answer: studentAnswer,
            max_marks: marks, question_type: questionType
          });
          questionStats.push({
            questionNumber: i + 1, questionText: keyQ.questionText, questionType,
            correctAnswer: keyAnswer, studentAnswer, marks,
            obtained: 0, isCorrect: false, isFullMarks: false, isPartial: false,
            feedback: "", correctPoints: [], missingPoints: []
          });
          continue;
        }

        // TRUE_FALSE
        if (questionType === "TRUE_FALSE") {
          const extractTrueFalse = (text) => {
            const lower = (text || "").toLowerCase().trim();
            if (lower.startsWith("true") || lower === "t") return "true";
            if (lower.startsWith("false") || lower === "f") return "false";
            return "";
          };
          const correctTF = extractTrueFalse(keyAnswer);
          const studentTF = extractTrueFalse(studentAnswer);
          let obtainedForQuestion = (correctTF && studentTF && correctTF === studentTF) ? marks : 0;
          obtainedForQuestion = roundToHalf(obtainedForQuestion);
          questionStats.push({
            questionNumber: i + 1, questionText: keyQ.questionText, questionType,
            correctAnswer: keyAnswer, studentAnswer, marks,
            obtained: obtainedForQuestion, isCorrect: obtainedForQuestion > 0,
            isFullMarks: obtainedForQuestion === marks, isPartial: false,
            feedback: obtainedForQuestion > 0 ? "Correct" : "Incorrect"
          });
          continue;
        }

        // MCQ (default)
        {
          const correctAnswers = extractLetters(keyAnswer);
          const studentAnswers = extractLetters(studentAnswer);
          const perOptionMark = marks / Math.max(correctAnswers.length, 1);
          let obtainedForQuestion = 0;
          correctAnswers.forEach(opt => {
            if (studentAnswers.includes(opt)) obtainedForQuestion += perOptionMark;
          });
          obtainedForQuestion = roundToHalf(obtainedForQuestion);
          questionStats.push({
            questionNumber: i + 1, questionText: keyQ.questionText, questionType,
            correctAnswer: keyAnswer, studentAnswer, marks,
            obtained: obtainedForQuestion, isCorrect: obtainedForQuestion > 0,
            isFullMarks: obtainedForQuestion === marks, isPartial: obtainedForQuestion > 0 && obtainedForQuestion < marks,
            feedback: obtainedForQuestion === marks ? "Correct" : obtainedForQuestion > 0 ? "Partial" : "Incorrect"
          });
        }
      }

      // LLM evaluation for SHORT/LONG
      if (questionsForLLM.length > 0) {
        try {
          const evalResponse = await axios.post(
            `${GEMINI_OCR_SERVICE_URL}/evaluate/subjective`,
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
          console.error(`Gemini LLM evaluation error for ${studentResponse.enrollmentNumber}:`, evalError.message);
        }
      }

      // Calculate totals
      const totalMarks = paper.totalMarks || questionStats.reduce((sum, q) => sum + q.marks, 0);
      const obtainedMarks = roundToHalf(questionStats.reduce((sum, q) => sum + q.obtained, 0));
      const percentage = totalMarks > 0 ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : 0;

      let grade = "F";
      if (percentage >= 90) grade = "A+";
      else if (percentage >= 80) grade = "A";
      else if (percentage >= 70) grade = "B+";
      else if (percentage >= 60) grade = "B";
      else if (percentage >= 50) grade = "C";
      else if (percentage >= 40) grade = "D";

      const result = await Result.findOneAndUpdate(
        { paper: paperId, enrollmentNumber: studentResponse.enrollmentNumber },
        {
          paper: paperId, subject: paper.subject._id,
          enrollmentNumber: studentResponse.enrollmentNumber,
          totalMarks, obtainedMarks, percentage, grade, questionStats,
          summary: {
            totalQuestions: questionStats.length,
            fullCorrect: questionStats.filter(q => q.isFullMarks).length,
            partialCorrect: questionStats.filter(q => q.isPartial).length,
            wrong: questionStats.filter(q => !q.isCorrect).length,
            attempted: questionStats.filter(q => q.studentAnswer).length
          },
          evaluatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      allResults.push(result);
      console.log(`   ${studentResponse.enrollmentNumber}: ${obtainedMarks}/${totalMarks} (${percentage}%)`);
    }

    const classStats = {
      totalStudents: allResults.length,
      averagePercentage: (allResults.reduce((sum, r) => sum + r.percentage, 0) / allResults.length).toFixed(2),
      highestScore: Math.max(...allResults.map(r => r.percentage)),
      lowestScore: Math.min(...allResults.map(r => r.percentage)),
      passCount: allResults.filter(r => r.percentage >= 40).length,
      passRate: ((allResults.filter(r => r.percentage >= 40).length / allResults.length) * 100).toFixed(2)
    };

    console.log(`\n==========================================`);
    console.log(`Evaluated ${allResults.length} students | Avg: ${classStats.averagePercentage}%`);
    console.log(`==========================================\n`);

    res.status(200).json({
      success: true,
      message: `Evaluated ${allResults.length} students (Gemini)`,
      paperName: paper.paperName,
      subjectName: paper.subject.name,
      totalMarks: paper.totalMarks,
      classStats,
      results: allResults
    });
  } catch (error) {
    console.error("Gemini paper evaluation error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HELPER FUNCTIONS ====================

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
          difficulty: "Not Analyzed",
          difficultyStats: { totalAttempts: 0, correctCount: 0, partialCount: 0, wrongCount: 0, accuracy: 0, avgScore: 0, lastAnalyzedAt: null }
        });
        addedCount++;
      }
    }

    await questionBank.save();
    await Subject.findByIdAndUpdate(subjectId, { totalQuestions: questionBank.totalQuestions });
    console.log(`QuestionBank: Added ${addedCount} new, updated ${updatedCount} existing`);
    return questionBank;
  } catch (error) {
    console.error("Error adding to question bank:", error);
    throw error;
  }
}
