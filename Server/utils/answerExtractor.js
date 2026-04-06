/**
 * Answer Extraction & Normalization Utility
 * Handles MCQ answer extraction from various formats
 */

/**
 * Extract and normalize MCQ answers from text
 * Handles formats like:
 * - "A" or "a"
 * - "Option A" or "option A"
 * - "A. text" (extracts just the letter)
 * - "A, C" or "A, B, C" (multiple correct answers)
 * - Full text like "The answer is A and C" (extracts letters)
 */
export const extractMCQAnswer = (answerText) => {
  if (!answerText) return "";
  
  // Convert to string and trim
  let text = String(answerText).trim();
  
  // Extract all option letters (A, B, C, D, E, etc.)
  const letterMatches = text.match(/[A-E]/gi);
  
  if (!letterMatches || letterMatches.length === 0) {
    return text; // Return as is if no letters found
  }
  
  // Get unique letters in uppercase, preserve order
  const uniqueLetters = [];
  for (const letter of letterMatches) {
    const upperLetter = letter.toUpperCase();
    if (!uniqueLetters.includes(upperLetter)) {
      uniqueLetters.push(upperLetter);
    }
  }
  
  // Join with comma and space for multiple answers
  return uniqueLetters.join(", ");
};

/**
 * Validate MCQ answer format
 * Ensures answer is in standardized format (e.g., "A" or "A, C")
 */
export const validateMCQAnswer = (answerText) => {
  if (!answerText) return false;
  
  const normalized = String(answerText).trim().toUpperCase();
  
  // Check if it contains valid option letters
  const validPattern = /^[A-E](,\s*[A-E])*$/;
  return validPattern.test(normalized);
};

/**
 * Normalize question data for consistent processing
 */
export const normalizeQuestion = (question) => {
  const normalized = {
    questionText: question.questionText || question.question_text || "",
    questionType: question.questionType || question.question_type || "MCQ",
    marks: Number(question.marks) || 1,
    options: question.options || [],
    answer: extractMCQAnswer(question.answer || question.Answer || ""),
    difficulty: question.difficulty || "Medium"
  };
  
  return normalized;
};

/**
 * Batch normalize multiple questions
 */
export const normalizeQuestions = (questions) => {
  if (!Array.isArray(questions)) return [];
  
  return questions.map(q => normalizeQuestion(q)).filter(q => q.questionText);
};

/**
 * Validate extracted answers consistency with options
 * Returns validation report with warnings
 */
export const validateAnswerConsistency = (question) => {
  const warnings = [];
  
  if (!question.answer) {
    warnings.push(`No answer extracted for: "${question.questionText.substring(0, 50)}..."`);
  }
  
  if (question.questionType === "MCQ" && question.options.length === 0) {
    warnings.push(`MCQ has no options: "${question.questionText.substring(0, 50)}..."`);
  }
  
  if (question.questionType === "MCQ" && question.answer) {
    // Validate answer letters are valid
    const answerLetters = question.answer.split(",").map(a => a.trim());
    const validLetters = ["A", "B", "C", "D", "E"];
    
    for (const letter of answerLetters) {
      if (!validLetters.includes(letter)) {
        warnings.push(`Invalid answer letter "${letter}" for: "${question.questionText.substring(0, 50)}..."`);
      }
    }
    
    if (question.options.length > 0 && question.options.length < answerLetters.length) {
      warnings.push(`Answer references more options than available for: "${question.questionText.substring(0, 50)}..."`);
    }
  }
  
  return {
    isValid: warnings.length === 0,
    warnings
  };
};

export default {
  extractMCQAnswer,
  validateMCQAnswer,
  normalizeQuestion,
  normalizeQuestions,
  validateAnswerConsistency
};
