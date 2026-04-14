/**
 * Validation Script for MCQ Answer Extraction
 * 
 * Usage:
 *   npm run validate-answers
 *   OR
 *   node Server/scripts/validate-answers.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import QuestionBank from "../models/QuestionBank.js";
import { validateAnswerConsistency } from "../utils/answerExtractor.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FIXED dotenv path
dotenv.config({ path: path.join(__dirname, "../.env") });

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

const log = {
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.cyan}${"=".repeat(60)}${colors.reset}\n${colors.cyan}${msg}${colors.reset}\n${colors.cyan}${"=".repeat(60)}${colors.reset}\n`)
};

async function validateAnswers() {
  try {
    log.section("MCQ Answer Extraction Validation");

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    log.success("Connected to MongoDB");

    // Get all question banks
    const banks = await QuestionBank.find({});

    if (banks.length === 0) {
      log.warning("No question banks found in database");
      return;
    }

    log.info(`Found ${banks.length} subject(s)`);

    let totalQuestions = 0;
    let questionsWithIssues = 0;
    const allWarnings = [];

    // Validate each subject
    for (const bank of banks) {
      const subjectName = bank.subjectName;
      const questionCount = bank.questions.length;
      totalQuestions += questionCount;

      log.section(`Subject: ${subjectName} (${questionCount} questions)`);

      // Check for empty question banks
      if (questionCount === 0) {
        log.warning(`No questions in ${subjectName}`);
        continue;
      }

      // Validate each question
      for (let i = 0; i < bank.questions.length; i++) {
        const q = bank.questions[i];
        const validation = validateAnswerConsistency(q);

        if (!validation.isValid) {
          questionsWithIssues++;
          log.error(`Question ${i + 1}:`);
          log.info(`  Text: "${q.questionText.substring(0, 60)}..."`);
          log.info(`  Type: ${q.questionType}`);
          log.info(`  Answer: "${q.answer}"`);
          
          validation.warnings.forEach(warning => {
            log.warning(`  • ${warning}`);
            allWarnings.push(`[${subjectName}] Q${i + 1}: ${warning}`);
          });
          console.log("");
        }
      }
    }

    // Summary Report
    log.section("VALIDATION SUMMARY");

    log.info(`Total Question Banks: ${banks.length}`);
    log.info(`Total Questions Analyzed: ${totalQuestions}`);
    
    if (questionsWithIssues === 0) {
      log.success(`All ${totalQuestions} questions passed validation! ✨`);
    } else {
      log.error(`${questionsWithIssues} question(s) have issues`);
      
      log.section("Issues Found");
      console.log(allWarnings.map((w, i) => `${i + 1}. ${w}`).join("\n"));
    }

    // Statistics
    log.section("STATISTICS");
    
    const mcqCount = banks.reduce(
      (sum, bank) => sum + bank.questions.filter(q => q.questionType === "MCQ").length,
      0
    );
    const shortCount = banks.reduce(
      (sum, bank) => sum + bank.questions.filter(q => q.questionType === "SHORT").length,
      0
    );
    const longCount = banks.reduce(
      (sum, bank) => sum + bank.questions.filter(q => q.questionType === "LONG").length,
      0
    );
    const trueFalseCount = banks.reduce(
      (sum, bank) => sum + bank.questions.filter(q => q.questionType === "TRUE_FALSE").length,
      0
    );

    log.info(`MCQ Questions: ${mcqCount}`);
    log.info(`SHORT Answer Questions: ${shortCount}`);
    log.info(`LONG Answer Questions: ${longCount}`);
    log.info(`TRUE/FALSE Questions: ${trueFalseCount}`);

    // Check for answers in MCQs
    const mcqWithoutAnswers = banks.reduce((sum, bank) => {
      return sum + bank.questions.filter(q => q.questionType === "MCQ" && !q.answer).length;
    }, 0);

    if (mcqWithoutAnswers > 0) {
      log.error(`${mcqWithoutAnswers} MCQ(s) without answers!`);
    } else if (mcqCount > 0) {
      log.success(`All ${mcqCount} MCQs have answers`);
    }

    await mongoose.connection.close();
    log.success("Database connection closed");

  } catch (error) {
    log.error(`Validation failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run validation
validateAnswers();
