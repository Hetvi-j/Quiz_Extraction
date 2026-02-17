import axios from "axios";
import fs from "fs";
import FormData from "form-data";

// Free OCR Service URL (Python service running on port 8001)
const FREE_OCR_SERVICE_URL = process.env.FREE_OCR_SERVICE_URL || "http://localhost:8001";

// Landing AI API key (for fallback when Groq returns too few questions)
const VA_API_KEY = process.env.LANDING_AI_API_KEY || "";

/**
 * Health check for Free OCR Service
 */
export const healthCheck = async (req, res) => {
  try {
    const response = await axios.get(`${FREE_OCR_SERVICE_URL}/health`, {
      timeout: 5000
    });

    res.status(200).json({
      success: true,
      service: "Free OCR (Groq Vision)",
      ...response.data
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Free OCR service is not running",
      details: "Start the service with: python Server/ocr_service_free.py",
      error: error.message
    });
  }
};

/**
 * Extract quiz data from uploaded file using Free OCR Service
 * This uses Groq Vision API - completely FREE (~7000 images/day)
 */
export const extractFromFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    console.log(`\n========== FREE OCR EXTRACTION ==========`);
    console.log(`File: ${fileName}`);

    // Create form data for the Python service
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);

    // Call the free OCR service
    const response = await axios.post(
      `${FREE_OCR_SERVICE_URL}/ocr/extract`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        timeout: 180000, // 3 minutes timeout for large PDFs
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    let extraction = response.data.extraction || {};
    console.log(`✅ Extracted ${extraction.questions?.length || 0} questions`);

    // Fallback to Landing AI if Groq returned suspiciously few questions
    const pageCountEstimate = req.body?.pageCount ? Number(req.body.pageCount) : null;
    const expectedMin = pageCountEstimate ? Math.max(5, pageCountEstimate * 2) : 10;

    if ((extraction.questions?.length || 0) < expectedMin && VA_API_KEY) {
      console.log("⚠️ Groq returned few questions — attempting Landing AI fallback...");
      try {
        // Call Landing AI parse + extract endpoints with the same file
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
        if (markdown) {
          const formExtract = new FormData();
          formExtract.append("markdown", markdown);
          formExtract.append("schema", JSON.stringify({ type: "object", properties: { questions: { type: "array" } } }));

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

          const landingExtraction = extractResponse.data.extraction || {};
          if (landingExtraction.questions && landingExtraction.questions.length > (extraction.questions?.length || 0)) {
            console.log(`✅ Landing AI returned ${landingExtraction.questions.length} questions — using Landing AI result`);
            extraction = landingExtraction;
          } else {
            console.log('ℹ️ Landing AI did not improve question count');
          }
        }
      } catch (e) {
        console.warn('Landing AI fallback failed:', e.message);
      }
    }

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch (e) {}

    console.log(`==========================================\n`);

    res.status(200).json({
      success: true,
      message: "Extraction successful",
      filename: fileName,
      documentInfo: extraction.documentInfo || {},
      questions: extraction.questions || [],
      totalQuestions: extraction.questions?.length || 0
    });

  } catch (error) {
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Free OCR extraction error:", error.message);

    // Handle specific error cases
    if (error.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        message: "Free OCR service is not running",
        details: "Start the service with: python Server/ocr_service_free.py"
      });
    }

    if (error.response?.data?.detail) {
      return res.status(500).json({
        success: false,
        message: error.response.data.detail
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Extract and process answer key using Free OCR
 */
export const extractAnswerKey = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Create form data
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);

    // Call free OCR service
    const response = await axios.post(
      `${FREE_OCR_SERVICE_URL}/ocr/extract`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 180000
      }
    );

    // Clean up
    fs.unlinkSync(filePath);

    const extraction = response.data.extraction || {};

    // Format questions for answer key storage
    const questions = (extraction.questions || []).map((q, index) => ({
      questionNumber: index + 1,
      questionText: q.questionText || `Question ${index + 1}`,
      questionType: q.questionType || "MCQ",
      marks: Number(q.marks) || 1,
      options: q.options || [],
      answer: q.Answer || q.answer || ""
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
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Answer key extraction error:", error.message);

    res.status(500).json({
      success: false,
      message: error.response?.data?.detail || error.message
    });
  }
};

/**
 * Extract student response using Free OCR
 */
export const extractStudentResponse = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Create form data
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), fileName);

    // Call free OCR service
    const response = await axios.post(
      `${FREE_OCR_SERVICE_URL}/ocr/extract`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 180000
      }
    );

    // Clean up
    fs.unlinkSync(filePath);

    const extraction = response.data.extraction || {};

    // Extract enrollment number from document or filename
    let enrollmentNumber = extraction.documentInfo?.enrollmentNumber || "0";
    if (enrollmentNumber === "0") {
      // Try to get from filename (remove extension)
      enrollmentNumber = fileName.replace(/\.[^/.]+$/, "");
    }

    // Format questions/answers
    const answers = (extraction.questions || []).map((q, index) => ({
      questionNumber: index + 1,
      questionText: q.questionText || "",
      answer: q.Answer || q.answer || ""
    }));

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
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error("Student response extraction error:", error.message);

    res.status(500).json({
      success: false,
      message: error.response?.data?.detail || error.message
    });
  }
};
