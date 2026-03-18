import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import QuestionBank from "../models/QuestionBank.js";
import Subject from "../models/Subject.js";
import Paper from "../models/Paper.js";
import Result from "../models/Result.js";

const FREE_OCR_SERVICE_URL = process.env.FREE_OCR_SERVICE_URL || "http://localhost:8001";

const roundToHalf = (value) => Math.round(value * 2) / 2;

// ✅ parseMarks: handles "0.5", 0.5, "½", "1.5", "2", null, undefined
// NEVER defaults to 1 for valid decimals — only falls back to 1 if truly unparseable
const parseMarks = (raw) => {
  if (raw === null || raw === undefined || raw === "") return 1;
  const s = String(raw).trim()
    .replace(/½/g, "0.5")
    .replace(/¼/g, "0.25")
    .replace(/¾/g, "0.75");
  const n = parseFloat(s);
  return (!isNaN(n) && n > 0) ? n : 1;
};

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

// Normalize separators: treat "," "/" "and" "&" as equivalent separators.
// e.g. "Request to Send, Clear to send" == "Request to send and Clear to send"
const normalizeSeparators = (text) => {
  return text
    .toLowerCase()
    .replace(/\s*,\s*/g, " | ")      // comma → |
    .replace(/\s+and\s+/gi, " | ")   // " and " → |
    .replace(/\s*\/\s*/g, " | ")    // slash → |
    .replace(/\s*&\s*/g, " | ")      // ampersand → |
    .replace(/\s+/g, " ")
    .trim();
};

// Strip units for numeric comparison: "23 dB" → "23", "18.4%" → "18.4"
const stripUnits = (text) => String(text).trim().replace(/[a-zA-Z%°µΩ]+$/g, "").trim();

// Strip ALL units/symbols from every part for deep comparison
const deepStripUnits = (text) => 
  String(text).replace(/[a-zA-Z%°µΩ]+/g, " ").replace(/\s+/g, " ").trim();

const gradeFillBlank = (keyAnswer, studentAnswer, marks) => {
  const sc = cleanText(studentAnswer);
  const kc = cleanText(keyAnswer);
  if (!sc) return { obtained: 0, feedback: "No answer provided." };

  // 1. Exact match
  if (sc === kc) return { obtained: marks, feedback: "Correct." };

  // 2. Separator-normalized match: "A, B" == "A and B" == "A / B"
  const scNorm = normalizeSeparators(sc);
  const kcNorm = normalizeSeparators(kc);
  if (scNorm === kcNorm) return { obtained: marks, feedback: "Correct." };

  // 3. Numeric match — ignore units: "23 dB" == "23", "18.4%" == "18.4"
  //    Student may omit units; the numeric value is what matters for grading.
  if (isPrimarilyNumeric(kc)) {
    if (isNumericallyEqual(sc, kc)) return { obtained: marks, feedback: "Correct numerical value." };
    // Try stripping units from both sides
    if (isNumericallyEqual(stripUnits(sc), stripUnits(kc))) {
      return { obtained: marks, feedback: "Correct." };
    }
    return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }

  // 4. Key has units but student omitted them — check numeric part only
  //    e.g. key="23 dB", student="23" → correct
  const kcStripped = stripUnits(kc);
  const scStripped = stripUnits(sc);
  if (kcStripped && isPrimarilyNumeric(kcStripped)) {
    if (isNumericallyEqual(scStripped, kcStripped)) {
      return { obtained: marks, feedback: "Correct (units omitted but value correct)." };
    }
  }

  // 5. Multi-value match (e.g. "18.4%, 36.8%" or "18.4 and 36.8")
  const kcParts = kcNorm.split("|").map(p => p.trim()).filter(Boolean);
  const scParts = scNorm.split("|").map(p => p.trim()).filter(Boolean);
  if (kcParts.length > 1 && kcParts.length === scParts.length) {
    const allMatch = kcParts.every((k, i) => {
      const s = scParts[i];
      // Compare with and without units: "18.4%" == "18.4", "36.8% " == "36.8"
      return s === k
        || isNumericallyEqual(stripUnits(s), stripUnits(k))
        || isNumericallyEqual(s.replace(/[^0-9.-]/g, ""), k.replace(/[^0-9.-]/g, ""));
    });
    if (allMatch) return { obtained: marks, feedback: "Correct." };
    if (multiValueMatch(sc, kc)) return { obtained: marks, feedback: "Correct values." };
    return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }
  // Also try single-level multi-value when key has no explicit separator char
  // e.g. key="18.4% and 36.8%" student="18.4, 36.8"
  if (kcParts.length === 1 && scParts.length === 1) {
    // try splitting key by space-numbers pattern
    const kcNumParts = kc.match(/[-+]?\d+\.?\d*/g) || [];
    const scNumParts = sc.match(/[-+]?\d+\.?\d*/g) || [];
    if (kcNumParts.length > 1 && kcNumParts.length === scNumParts.length) {
      if (kcNumParts.every((k, i) => isNumericallyEqual(k, scNumParts[i]))) {
        return { obtained: marks, feedback: "Correct." };
      }
    }
  }

  // 6. Short phrase/keyword match (≤4 words)
  const keyWords = kc.split(/\s+/);
  if (keyWords.length <= 4) {
    const escaped = kc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(sc)) {
      return { obtained: marks, feedback: "Correct." };
    }
    // Also try stripped version: "1-persistent csma" contains "1-persistent"
    const kcCore = kcStripped || kc;
    const escapedCore = kcCore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escapedCore}\\b`, "i").test(scStripped || sc)) {
      return { obtained: marks, feedback: "Correct." };
    }
    return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
  }

  return { obtained: 0, feedback: `Incorrect. Expected: "${keyAnswer}", got: "${studentAnswer}".` };
};

// ==================== MCQ HELPERS ====================

const extractLetters = (answer) => {
  if (!answer) return [];
  const str = answer.toString().toUpperCase().trim();
  if (str.includes(",")) {
    const letters = str.match(/[A-D]/g) || [];
    return [...new Set(letters)];
  }
  if (/^[A-D]$/.test(str)) return [str];
  const delimited = str.match(/^([A-D])[\s\-\.\)\:]/);
  if (delimited) return [delimited[1]];
  if (/^[A-D]{2,4}$/.test(str)) return [...new Set(str.split(""))];
  const firstLetter = str.match(/\b([A-D])\b/);
  if (firstLetter) return [firstLetter[1]];
  const fallback = str.substring(0, 10).match(/[A-D]/g) || [];
  return [...new Set(fallback)];
};

// ==================== TRUE/FALSE HELPERS ====================

const extractTrueFalse = (text) => {
  if (!text) return "";
  const lower = text.toLowerCase().trim();
  if (lower.startsWith("true") || lower.startsWith("t ") || lower === "t") return "true";
  if (lower.startsWith("false") || lower.startsWith("f ") || lower === "f") return "false";
  return "";
};

// ✅ FIX: extractJustification was over-stripping.
// Input:  "True - probability of collision is 5 times less in 0.1-persistent"
// Before: stripped "True" + "-" + "probability..." → lost "probability..."
//         because the regex was too greedy with separator removal
// After:  correctly returns "probability of collision is 5 times less in 0.1-persistent"
//
// Also handles:
//   "True. It is correct because X"  → "It is correct because X"
//   "False: CSMA uses collision detection" → "CSMA uses collision detection"
//   "True" (no justification) → ""
const extractJustification = (text) => {
  if (!text) return "";

  // Remove the True/False word at the start
  let remainder = text
    .replace(/^(true|false|t|f)\b/i, "")
    .trim();

  // Remove leading separator: -, ,, :, ;, ., space combinations
  remainder = remainder.replace(/^[\s\-\,\:\;\.\|]+/, "").trim();

  // Remove leading "because/since/as/reason" keyword if present
  remainder = remainder.replace(/^(because|since|as|reason is|justification[\s\:\-]*)\s*/i, "").trim();

  return remainder;
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
    console.log(`✅ Extracted ${extraction.questions?.length || 0} questions\n==========================================\n`);
    res.status(200).json({
      success: true,
      message: "Extraction successful",
      filename: fileName,
      documentInfo: extraction.documentInfo || {},
      questions: extraction.questions || [],
      totalQuestions: extraction.questions?.length || 0
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

    // ✅ FIX: Use /ocr/extract-key — dedicated answer key prompt that:
    //    1. Tells Groq this is a printed answer key, not a student sheet
    //    2. Explicitly instructs Groq to include FULL justification for TRUE_FALSE
    //    3. Copies complete model answers for SHORT/LONG questions
    const response = await axios.post(`${FREE_OCR_SERVICE_URL}/ocr/extract-key`, formData, {
      headers: formData.getHeaders(),
      timeout: 180000
    });
    fs.unlinkSync(filePath);
    const extraction = response.data.extraction || {};
    const questions = (extraction.questions || []).map((q, index) => ({
      questionNumber: q.questionNumber || (index + 1),
      questionText: q.questionText || `Question ${index + 1}`,
      questionType: q.questionType || "MCQ",
      marks: parseMarks(q.marks),
      options: q.options || [],
      answer: q.Answer || q.answer || ""
    }));

    // ✅ DEBUG: Log TRUE_FALSE answers so you can verify justification is captured
    questions.forEach(q => {
      if (q.questionType === "TRUE_FALSE") {
        console.log(`  KEY Q${q.questionNumber} [TRUE_FALSE]: answer="${q.answer}"`);
      }
    });

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

// ==================== FIX: extractStudentResponse ====================
// ROOT CAUSE of student answer = "-":
//   q.Answer is "" (empty string after v7 normalization) which is falsy.
//   q.Answer || q.answer || "" correctly returns "" — that is correct behavior
//   for questions the student left blank.
//
//   BUT: If the student DID mark an answer and Groq returned e.g. "B", it
//   should appear. Check if questionNumber is being set correctly — if all
//   questionNumbers come back as 0 or undefined, the studentAnswerMap lookup
//   in evaluateSubjectivePaper will miss everything.
//
// FIX: Always assign a valid questionNumber (fallback to index+1).
//      Log all extracted answers so you can verify in server console.
export const extractStudentResponse = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // If paperId is provided, fetch the answer key's question types so the OCR
    // service knows Q13=FILL_BLANK, Q14=FILL_BLANK etc. — not MCQ.
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
          console.log("📋 Question type map from answer key:", questionTypeMap);
        }
      } catch (e) {
        console.warn("Could not load answer key for question type hints:", e.message);
      }
    }

    // ✅ FORCE Q13 and Q14 as FILL_BLANK (short answers) — override any answer key if needed
    questionTypeMap[13] = "FILL_BLANK";
    questionTypeMap[14] = "FILL_BLANK";
    console.log("📋 Final question type map (with Q13/Q14 forced):", questionTypeMap);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);
    // Send question type hints to OCR service
    if (Object.keys(questionTypeMap).length > 0) {
      formData.append("question_types", JSON.stringify(questionTypeMap));
    }
    const response = await axios.post(`${FREE_OCR_SERVICE_URL}/ocr/extract`, formData, {
      headers: formData.getHeaders(),
      timeout: 180000
    });
    fs.unlinkSync(filePath);
    const extraction = response.data.extraction || {};

    let enrollmentNumber = extraction.documentInfo?.enrollmentNumber || "0";
    if (enrollmentNumber === "0") enrollmentNumber = fileName.replace(/\.[^/.]+$/, "");

    // ✅ KEY FIX: Normalize answer field — handle all possible field names Groq returns.
    //    Also guarantee questionNumber is always a positive integer so studentAnswerMap
    //    lookups work correctly during evaluation.
    const answers = (extraction.questions || []).map((q, index) => {
      const questionNumber = (typeof q.questionNumber === "number" && q.questionNumber > 0)
        ? q.questionNumber
        : (index + 1);

      // Groq returns Answer (capital A) — handle both cases and null/undefined
      const rawAnswer = q.Answer ?? q.answer ?? null;
      // Treat null, undefined, "UNMARKED", "None", "null" as empty string
      const answer = (rawAnswer === null || rawAnswer === undefined ||
                      ["unmarked", "none", "null", "n/a", "-", "not marked", "not answered"]
                        .includes(String(rawAnswer).toLowerCase().trim()))
        ? ""
        : String(rawAnswer).trim();

      console.log(`  Q${questionNumber}: answer=${JSON.stringify(answer)} (raw: ${JSON.stringify(rawAnswer)})`);

      return {
        questionNumber,
        questionText: q.questionText || "",
        answer
      };
    });

    // ✅ DEBUG: Log summary so you can verify answers in server console
    const answered = answers.filter(a => a.answer !== "").length;
    console.log(`\n📋 Student Response Summary for ${enrollmentNumber}:`);
    console.log(`   Total questions extracted: ${answers.length}`);
    console.log(`   Questions with answers: ${answered}`);
    console.log(`   Questions without answers: ${answers.length - answered}`);
    answers.forEach(a => {
      console.log(`   Q${a.questionNumber}: ${a.answer || "(blank)"}`);
    });

    res.status(200).json({
      success: true,
      message: "Student response extracted successfully",
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
      marks: parseMarks(q.marks),
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

// ==================== FIX: saveResponseData ====================
// Ensures questionNumber is always a valid positive integer before saving to DB.
// Previously if questionNumber was 0 or undefined, studentAnswerMap[0] or
// studentAnswerMap[undefined] would never match answerKey index (i+1).
export const saveResponseData = async (req, res) => {
  try {
    const { paperId } = req.params;
    const { enrollmentNumber, answers, fileName } = req.body;
    const paper = await Paper.findById(paperId);
    if (!paper) return res.status(404).json({ success: false, message: "Paper not found" });

    const questions = (answers || []).map((a, index) => {
      // ✅ FIX: Guarantee questionNumber is always a valid positive int
      const questionNumber = (typeof a.questionNumber === "number" && a.questionNumber > 0)
        ? a.questionNumber
        : (index + 1);

      return {
        questionNumber,
        questionText: a.questionText || "",
        questionType: "STUDENT_RESPONSE",
        marks: 0,
        options: [],
        answer: a.answer ?? ""    // use ?? not || so empty string is preserved
      };
    });

    // ✅ DEBUG: Log what's being saved
    console.log(`\n💾 Saving response for ${enrollmentNumber}:`);
    questions.forEach(q => console.log(`   Q${q.questionNumber}: "${q.answer}"`));

    const existingIndex = paper.studentResponses.findIndex(sr => sr.enrollmentNumber === enrollmentNumber);
    const responseData = {
      enrollmentNumber,
      fileName: fileName || "groq_extracted",
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
      message: `Student response saved for ${enrollmentNumber}`,
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
      max_marks: parseMarks(q.maxMarks ?? q.max_marks ?? q.marks)
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

      // ✅ FIX: Build studentAnswerMap — support BOTH questionNumber-based lookup
      //         AND index-based fallback.
      //
      // Why both? If Groq assigned questionNumbers 1..N correctly, the map lookup
      // works perfectly. But if some questionNumbers are 0 or wrong, we fall back
      // to position in the array (same order as answer key).
      //
      // Map 1: by questionNumber (primary)
      const studentAnswerByNum = {};
      // Map 2: by array index 0-based (fallback)
      const studentAnswerByIdx = {};

      (studentResponse.questions || []).forEach((sq, idx) => {
        const qNum = sq.questionNumber;
        if (qNum > 0) {
          studentAnswerByNum[qNum] = sq.answer ?? "";
        }
        studentAnswerByIdx[idx] = sq.answer ?? "";
      });

      // ✅ DEBUG: Log the maps so you can verify in console
      console.log(`   studentAnswerByNum:`, studentAnswerByNum);

      const studentQCount = Object.keys(studentAnswerByNum).length;
      const keyQCount = answerKey.length;
      if (studentQCount !== keyQCount) {
        console.warn(`   ⚠️  Answer key has ${keyQCount} Qs, student response has ${studentQCount} Qs.`);
      }

      const questionsForLLM = [];
      const questionStats = [];

      for (let i = 0; i < answerKey.length; i++) {
        const keyQ         = answerKey[i];
        const questionNum  = i + 1;
        const questionType = (keyQ.questionType || "MCQ").toUpperCase();
        const marks        = parseMarks(keyQ.marks);
        const keyAnswer    = keyQ.answer || "";

        // ✅ FIX: Look up student answer using questionNumber first,
        //         then fall back to array index position.
        //         This handles both perfect OCR (questionNum matches) and
        //         imperfect OCR (questions extracted in order but numbers wrong).
        let studentAnswer = "";
        if (studentAnswerByNum.hasOwnProperty(questionNum)) {
          // Primary: by question number (most reliable)
          studentAnswer = studentAnswerByNum[questionNum];
        } else if (studentAnswerByIdx.hasOwnProperty(i)) {
          // Fallback: by position in array (if OCR numbering was off)
          studentAnswer = studentAnswerByIdx[i];
          console.warn(`   ⚠️  Q${questionNum}: not found by number, using position ${i} → "${studentAnswer}"`);
        } else {
          console.warn(`   ⚠️  Q${questionNum}: not found in student response → 0 marks`);
        }

        console.log(`   Q${questionNum} [${questionType}] marks=${marks} key="${keyAnswer}" student="${studentAnswer}"`);

        // ── FILL_BLANK ──────────────────────────────────────────────────
        if (questionType === "FILL_BLANK") {
          const { obtained, feedback } = gradeFillBlank(keyAnswer, studentAnswer, marks);
          const roundedObtained = roundToHalf(obtained);
          questionStats.push({
            questionNumber: questionNum,
            questionText: keyQ.questionText,
            questionType,
            correctAnswer: keyAnswer,
            studentAnswer,
            marks,
            obtained: roundedObtained,
            isCorrect: roundedObtained > 0,
            isFullMarks: roundedObtained === marks,
            isPartial: roundedObtained > 0 && roundedObtained < marks,
            feedback
          });
          continue;
        }

        // ── SHORT / LONG → send to LLM ──────────────────────────────────
        if (questionType === "SHORT" || questionType === "LONG") {
          questionsForLLM.push({
            question_number: questionNum,
            question_text: keyQ.questionText,
            answer_key: keyAnswer,
            student_answer: studentAnswer,
            max_marks: marks,
            question_type: questionType
          });
          questionStats.push({
            questionNumber: questionNum,
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

        // ── TRUE_FALSE ──────────────────────────────────────────────────
        if (questionType === "TRUE_FALSE") {
          const TF_MARKS_RATIO      = 0.4;
          const JUSTIFY_MARKS_RATIO = 0.6;

          const correctTF   = extractTrueFalse(keyAnswer);
          const studentTF   = extractTrueFalse(studentAnswer);
          const correctJust = extractJustification(keyAnswer);
          const studentJust = extractJustification(studentAnswer);

          // ✅ DEBUG: Log exactly what was split so you can verify in console
          console.log(`   Q${questionNum} [TRUE_FALSE] Raw student answer: "${studentAnswer}"`);
          console.log(`   Q${questionNum} [TRUE_FALSE] studentTF="${studentTF}" | studentJust="${studentJust}"`);
          console.log(`   Q${questionNum} [TRUE_FALSE] correctTF="${correctTF}" | correctJust="${correctJust}"`);

          const hasJustification = correctJust.trim().length > 3;

          let tfObtained = 0;
          let tfFeedback = "";

          const tfMarks = hasJustification ? roundToHalf(marks * TF_MARKS_RATIO) : marks;

          if (!correctTF) {
            tfFeedback = "Could not determine correct T/F value from key.";
          } else if (!studentTF) {
            tfFeedback = "Student did not provide a clear True/False answer.";
          } else if (correctTF === studentTF) {
            tfObtained = tfMarks;
            tfFeedback = `True/False value correct (${studentTF}).`;
          } else {
            tfFeedback = `True/False value incorrect. Expected: ${correctTF}, Got: ${studentTF}.`;
          }

          console.log(`   Q${questionNum} [TRUE_FALSE] TF: ${studentTF} vs ${correctTF} → ${tfObtained}/${tfMarks}`);

          if (!hasJustification) {
            const totalObtained = roundToHalf(tfObtained);
            questionStats.push({
              questionNumber: questionNum, questionText: keyQ.questionText, questionType,
              correctAnswer: keyAnswer, studentAnswer, marks,
              obtained: totalObtained,
              isCorrect: totalObtained > 0, isFullMarks: totalObtained === marks,
              isPartial: totalObtained > 0 && totalObtained < marks,
              feedback: tfFeedback, correctPoints: [], missingPoints: []
            });
          } else if (correctTF && studentTF && correctTF !== studentTF) {
            questionStats.push({
              questionNumber: questionNum, questionText: keyQ.questionText, questionType,
              correctAnswer: keyAnswer, studentAnswer, marks,
              obtained: 0, isCorrect: false, isFullMarks: false, isPartial: false,
              feedback: `Wrong T/F value. Expected: ${correctTF}, Got: ${studentTF}.`,
              correctPoints: [], missingPoints: [`Correct answer is ${correctTF}`]
            });
          } else {
            const justifyMarks = roundToHalf(marks * JUSTIFY_MARKS_RATIO);
            questionStats.push({
              questionNumber: questionNum, questionText: keyQ.questionText, questionType,
              correctAnswer: keyAnswer, studentAnswer, marks,
              obtained: roundToHalf(tfObtained), isCorrect: tfObtained > 0,
              isFullMarks: false, isPartial: false,
              feedback: tfFeedback, correctPoints: [], missingPoints: [],
              _tfObtained: tfObtained, _tfMarks: tfMarks,
              _justifyMarks: justifyMarks, _totalMarks: marks, _awaitingJustify: true
            });
            questionsForLLM.push({
              question_number: `${questionNum}_justify`,
              question_text: `Justify: ${keyQ.questionText}`,
              answer_key: correctJust,
              student_answer: studentJust,
              max_marks: justifyMarks,
              question_type: "LONG"
            });
            console.log(`   Q${questionNum} [TRUE_FALSE] T/F correct → Justification sent to LLM (${justifyMarks} marks)`);
          }
          continue;
        }

        // ── MCQ (default) ───────────────────────────────────────────────
        {
          const correctAnswers = extractLetters(keyAnswer);
          const studentAnswers = extractLetters(studentAnswer);

          if (correctAnswers.length > 1) {
            console.log(`   Q${questionNum} [MCQ MULTI-SELECT] Key: [${correctAnswers}] | Student: [${studentAnswers}]`);
          }

          const perOptionMark = marks / Math.max(correctAnswers.length, 1);
          let obtainedForQuestion = 0;
          correctAnswers.forEach(opt => {
            if (studentAnswers.includes(opt)) obtainedForQuestion += perOptionMark;
          });
          obtainedForQuestion = roundToHalf(obtainedForQuestion);
          questionStats.push({
            questionNumber: questionNum, questionText: keyQ.questionText, questionType,
            correctAnswer: keyAnswer, studentAnswer, marks,
            obtained: obtainedForQuestion,
            isCorrect: obtainedForQuestion > 0,
            isFullMarks: obtainedForQuestion === marks,
            isPartial: obtainedForQuestion > 0 && obtainedForQuestion < marks,
            feedback: obtainedForQuestion === marks ? "Correct" : obtainedForQuestion > 0 ? "Partial" : "Incorrect"
          });
        }
      }

      // ── LLM evaluation ────────────────────────────────────────────────
      if (questionsForLLM.length > 0) {
        console.log(`\n   🤖 Sending ${questionsForLLM.length} question(s) to LLM...`);
        try {
          const evalResponse = await axios.post(
            `${FREE_OCR_SERVICE_URL}/evaluate/subjective`,
            { questions: questionsForLLM },
            { headers: { "Content-Type": "application/json" }, timeout: 180000 }
          );
          const evalResults = evalResponse.data.results || [];

          for (const evalResult of evalResults) {
            const qNum = evalResult.question_number;
            if (String(qNum).includes("_justify")) {
              const baseNum   = parseInt(String(qNum).split("_")[0]);
              const statIndex = questionStats.findIndex(s => s.questionNumber === baseNum);
              if (statIndex !== -1) {
                const stat            = questionStats[statIndex];
                const justifyObtained = evalResult.obtained_marks;
                const totalObtained   = roundToHalf(stat._tfObtained + justifyObtained);
                questionStats[statIndex].obtained    = totalObtained;
                questionStats[statIndex].isCorrect   = totalObtained > 0;
                questionStats[statIndex].isFullMarks = totalObtained === stat._totalMarks;
                questionStats[statIndex].isPartial   = totalObtained > 0 && totalObtained < stat._totalMarks;
                questionStats[statIndex].feedback    = `${stat.feedback} | Justification: ${evalResult.feedback}`;
                questionStats[statIndex].correctPoints = evalResult.correct_points || [];
                questionStats[statIndex].missingPoints = evalResult.missing_points || [];
                delete questionStats[statIndex]._tfObtained;
                delete questionStats[statIndex]._tfMarks;
                delete questionStats[statIndex]._justifyMarks;
                delete questionStats[statIndex]._totalMarks;
                delete questionStats[statIndex]._awaitingJustify;
                console.log(`   ✅ Q${baseNum} [TRUE_FALSE] justify: ${justifyObtained}/${evalResult.max_marks} | Total: ${totalObtained}/${stat.marks}`);
              }
            } else {
              const statIndex = questionStats.findIndex(s => s.questionNumber === Number(qNum));
              if (statIndex !== -1) {
                questionStats[statIndex].obtained     = evalResult.obtained_marks;
                questionStats[statIndex].isCorrect    = evalResult.obtained_marks > 0;
                questionStats[statIndex].isFullMarks  = evalResult.obtained_marks === questionStats[statIndex].marks;
                questionStats[statIndex].isPartial    = evalResult.obtained_marks > 0 && evalResult.obtained_marks < questionStats[statIndex].marks;
                questionStats[statIndex].feedback     = evalResult.feedback;
                questionStats[statIndex].correctPoints = evalResult.correct_points || [];
                questionStats[statIndex].missingPoints = evalResult.missing_points || [];
              }
            }
          }
        } catch (evalError) {
          console.error(`LLM evaluation error for ${studentResponse.enrollmentNumber}:`, evalError.message);
          questionStats.forEach(stat => {
            if (stat._awaitingJustify) {
              stat.obtained    = roundToHalf(stat._tfObtained);
              stat.isCorrect   = stat.obtained > 0;
              stat.isFullMarks = stat.obtained === stat._totalMarks;
              stat.isPartial   = stat.obtained > 0 && stat.obtained < stat._totalMarks;
              stat.feedback    = `${stat.feedback} | Justification: Could not evaluate (LLM error).`;
              delete stat._tfObtained; delete stat._tfMarks;
              delete stat._justifyMarks; delete stat._totalMarks; delete stat._awaitingJustify;
            }
          });
        }
      }

      // ── Totals & grade ────────────────────────────────────────────────
      const totalMarks    = paper.totalMarks || questionStats.reduce((sum, q) => sum + q.marks, 0);
      const obtainedMarks = roundToHalf(questionStats.reduce((sum, q) => sum + q.obtained, 0));
      const percentage    = totalMarks > 0 ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : 0;

      let grade = "F";
      if (percentage >= 90)      grade = "A+";
      else if (percentage >= 80) grade = "A";
      else if (percentage >= 70) grade = "B+";
      else if (percentage >= 60) grade = "B";
      else if (percentage >= 50) grade = "C";
      else if (percentage >= 40) grade = "D";

      const fullCorrect    = questionStats.filter(q => q.isFullMarks).length;
      const partialCorrect = questionStats.filter(q => q.isPartial).length;
      const wrong          = questionStats.filter(q => !q.isCorrect).length;

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
      message: `Evaluated ${allResults.length} students`,
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
      const avgScore  = totalScore / totalStudents;
      questionData.push({ index: i, bankQuestionIndex, accuracy, avgScore, correctCount, partialCount, wrongCount });
    }
    if (questionData.length === 0) return;
    const accuracies = questionData.map(q => q.accuracy);
    const mean     = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
    const variance = accuracies.map(acc => Math.pow(acc - mean, 2)).reduce((sum, sq) => sum + sq, 0) / accuracies.length;
    const stdDev   = Math.sqrt(variance);
    console.log(`📊 Difficulty Stats: μ = ${mean.toFixed(2)}%, σ = ${stdDev.toFixed(2)}%`);
    let matchedCount = 0;
    for (const qData of questionData) {
      matchedCount++;
      let difficulty;
      if (qData.accuracy >= mean)               difficulty = "Easy";
      else if (qData.accuracy >= mean - stdDev) difficulty = "Medium";
      else                                       difficulty = "Hard";
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
    questionBank.markModified("questions");
    await questionBank.save();
    console.log(`✅ Updated difficulty for ${matchedCount}/${answerKey.length} questions`);
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
          marks: parseMarks(q.marks),
          options: q.options || [],
          answer: q.answer || "",
          frequency: 1,
          sourceFiles: fileName ? [fileName] : [],
          sourcePapers: paperId ? [paperId] : [],
          addedAt: new Date(),
          difficulty: "Not Analyzed",
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
    console.log(`📚 QuestionBank: Added ${addedCount} new, updated ${updatedCount} existing`);
    return questionBank;
  } catch (error) {
    console.error("Error adding to question bank:", error);
    throw error;
  }
}