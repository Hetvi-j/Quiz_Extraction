import axios from "axios";
import fs from "fs";
import FormData from "form-data";

const FREE_OCR_SERVICE_URL = process.env.FREE_OCR_SERVICE_URL || "http://localhost:8001";
const MCQ_GUARD_SERVICE_URL = process.env.MCQ_GUARD_SERVICE_URL || "http://localhost:8003";

const strictMcqLetters = (answer) => {
  if (!answer) return [];
  const text = String(answer).trim();
  if (!text) return [];
  if (text === "-") return ["-"];
  if (/^\s*[\(\[]?[A-D][\)\]]?\s*(?:[,/&\s]+\s*[\(\[]?[A-D][\)\]]?\s*)*$/i.test(text)) {
    const letters = (text.match(/(?<![A-Za-z0-9])[A-D](?![A-Za-z0-9])/gi) || []).map((x) => x.toUpperCase());
    return [...new Set(letters)];
  }
  const standalone = text.match(/(?<![A-Za-z0-9])[A-D](?![A-Za-z0-9])/gi) || [];
  if (!standalone.length) return [];
  return [standalone[standalone.length - 1].toUpperCase()];
};

const isPatternNoise = (value) => {
  if (!value) return false;
  const ans = String(value).trim().toLowerCase();
  return ["cbdac", "abcd", "abcdcba", "cbadcbad"].includes(ans) || /^[a-d]{4,}$/.test(ans);
};

const localPickMcq = (groqAnswer) => {
  let g = (groqAnswer || "").trim();
  if (isPatternNoise(g)) g = "";
  const gl = strictMcqLetters(g);
  if (gl.length) return gl.join(",");
  if (g === "-") return "-";
  return "";
};

const extractByService = async (url, filePath, fileName, path, questionTypes = null) => {
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath), fileName);
  if (questionTypes) {
    formData.append("question_types", JSON.stringify(questionTypes));
  }
  const response = await axios.post(`${url}${path}`, formData, {
    headers: formData.getHeaders(),
    timeout: 180000
  });
  return response.data?.extraction || {};
};

const applyHybridMcqMerge = async (groqQuestions = []) => {
  const candidates = groqQuestions.map((q, idx) => {
    const qNo = Number(q.questionNumber || q.q_no || idx + 1);
    return {
      questionNumber: qNo,
      questionType: q.questionType || q.question_type || "MCQ",
      groqAnswer: q.Answer || q.answer || q.student_ans || "",
      geminiAnswer: ""
    };
  });

  let guarded = [];
  try {
    const resp = await axios.post(`${MCQ_GUARD_SERVICE_URL}/mcq/normalize`, { candidates }, { timeout: 30000 });
    guarded = resp.data?.results || [];
  } catch {
    guarded = candidates.map((c) => ({
      questionNumber: c.questionNumber,
      answer: (String(c.questionType || "MCQ").toUpperCase() === "MCQ")
        ? localPickMcq(c.groqAnswer)
        : c.groqAnswer
    }));
  }

  const byNumGuard = new Map(guarded.map((g) => [Number(g.questionNumber), g.answer || ""]));
  return groqQuestions.map((q, idx) => {
    const qNo = Number(q.questionNumber || q.q_no || idx + 1);
    const qType = String(q.questionType || q.question_type || "MCQ").toUpperCase();
    if (qType !== "MCQ") return q;
    return { ...q, Answer: byNumGuard.get(qNo) ?? (q.Answer || "") };
  });
};

export const healthCheck = async (req, res) => {
  try {
    const [groqHealth, guardHealth] = await Promise.allSettled([
      axios.get(`${FREE_OCR_SERVICE_URL}/health`, { timeout: 5000 }),
      axios.get(`${MCQ_GUARD_SERVICE_URL}/health`, { timeout: 5000 })
    ]);
    res.status(200).json({
      success: true,
      service: "Hybrid OCR (Groq + Local MCQ guard)",
      groq: groqHealth.status === "fulfilled",
      mcqGuard: guardHealth.status === "fulfilled"
    });
  } catch (error) {
    res.status(503).json({ success: false, message: error.message });
  }
};

export const extractFromFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    const groqExtraction = await extractByService(FREE_OCR_SERVICE_URL, filePath, fileName, "/ocr/extract");
    const mergedQuestions = await applyHybridMcqMerge(groqExtraction.questions || []);

    fs.unlinkSync(filePath);
    return res.status(200).json({
      success: true,
      message: "Hybrid extraction successful",
      filename: fileName,
      documentInfo: groqExtraction.documentInfo || {},
      questions: mergedQuestions,
      totalQuestions: mergedQuestions.length
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

export const extractAnswerKey = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    const groqExtraction = await extractByService(FREE_OCR_SERVICE_URL, filePath, fileName, "/ocr/extract-key");
    const mergedQuestions = await applyHybridMcqMerge(groqExtraction.questions || []);

    const questions = mergedQuestions.map((q, index) => ({
      questionNumber: Number(q.questionNumber || q.q_no || index + 1),
      questionText: q.questionText || q.text || `Question ${index + 1}`,
      questionType: q.questionType || q.question_type || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.Answer || q.answer || q.student_ans || ""
    }));

    fs.unlinkSync(filePath);
    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
    return res.status(200).json({
      success: true,
      message: "Hybrid answer key extracted",
      filename: fileName,
      documentInfo: groqExtraction.documentInfo || {},
      questions,
      totalQuestions: questions.length,
      totalMarks
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

export const extractStudentResponse = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const questionTypes = req.body.question_types ? JSON.parse(req.body.question_types) : null;

    const groqExtraction = await extractByService(FREE_OCR_SERVICE_URL, filePath, fileName, "/ocr/extract", questionTypes);
    const mergedQuestions = await applyHybridMcqMerge(groqExtraction.questions || []);

    const docInfo = groqExtraction.documentInfo || {};
    let enrollmentNumber = docInfo.enrollmentNumber || "0";
    if (enrollmentNumber === "0") enrollmentNumber = fileName.replace(/\.[^/.]+$/, "");

    const answers = mergedQuestions.map((q, index) => ({
      questionNumber: Number(q.questionNumber || q.q_no || index + 1),
      questionText: q.questionText || q.text || "",
      answer: q.Answer || q.answer || q.student_ans || ""
    }));

    fs.unlinkSync(filePath);
    return res.status(200).json({
      success: true,
      message: "Hybrid student response extracted",
      filename: fileName,
      enrollmentNumber,
      documentInfo: docInfo,
      answers,
      totalAnswers: answers.length
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ success: false, message: error.response?.data?.detail || error.message });
  }
};

