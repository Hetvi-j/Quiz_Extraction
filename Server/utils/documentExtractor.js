/**
 * Unified Document Extractor
 * Supports multiple extraction APIs: Landing AI and Google Gemini
 *
 * Set EXTRACTOR_API in .env to choose:
 * - "landing" (default) - Uses Landing AI
 * - "gemini" - Uses Google Gemini (free tier: 1500 req/day)
 */

import { extractQuestionsFromPDF as extractWithLanding } from "./pdfExtractor.js";
import { extractQuestionsFromPDF as extractWithGemini, extractQuestionsWithGemini } from "./geminiExtractor.js";

// Get the configured extractor API
const EXTRACTOR_API = process.env.EXTRACTOR_API || "landing";

/**
 * Extract questions from a PDF or image file
 * Uses the configured API (Landing AI or Gemini)
 *
 * @param {string} filePath - Path to the PDF or image file
 * @returns {Promise<Array>} - Array of extracted questions
 */
export async function extractQuestionsFromPDF(filePath) {
  console.log(`[Extractor] Using ${EXTRACTOR_API.toUpperCase()} API`);

  try {
    if (EXTRACTOR_API === "gemini") {
      return await extractWithGemini(filePath);
    } else {
      return await extractWithLanding(filePath);
    }
  } catch (error) {
    console.error(`[Extractor] ${EXTRACTOR_API} failed:`, error.message);

    // Fallback to the other API if one fails
    if (EXTRACTOR_API === "gemini") {
      console.log("[Extractor] Falling back to Landing AI...");
      return await extractWithLanding(filePath);
    } else {
      console.log("[Extractor] Falling back to Gemini...");
      return await extractWithGemini(filePath);
    }
  }
}

/**
 * Extract questions with full document info
 * Only available with Gemini
 *
 * @param {string} filePath - Path to the PDF or image file
 * @returns {Promise<{documentInfo: Object, questions: Array}>}
 */
export async function extractWithDocumentInfo(filePath) {
  if (EXTRACTOR_API === "gemini") {
    return await extractQuestionsWithGemini(filePath);
  } else {
    // Landing AI doesn't return document info in the same way
    const questions = await extractWithLanding(filePath);
    return {
      documentInfo: {},
      questions
    };
  }
}

/**
 * Force use of a specific API regardless of config
 */
export async function extractWithAPI(filePath, api = "landing") {
  if (api === "gemini") {
    return await extractWithGemini(filePath);
  } else {
    return await extractWithLanding(filePath);
  }
}

export default {
  extractQuestionsFromPDF,
  extractWithDocumentInfo,
  extractWithAPI
};
