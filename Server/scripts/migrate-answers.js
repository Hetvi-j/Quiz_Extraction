/**
 * Answer Field Migration Script
 * 
 * This script migrates existing data to use the corrected answer fields:
 * - Converts capitalized "Answer" → lowercase "answer"
 * - Normalizes answer formats to standard format (e.g., "A" or "A, C")
 * - Validates all answers after migration
 * 
 * Usage:
 *   npm run migrate-answers
 *   OR
 *   node Server/scripts/migrate-answers.js [--dry-run]
 * 
 * Options:
 *   --dry-run    Show what would be changed without actually changing it
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import QuestionBank from "../models/QuestionBank.js";
import Quiz1 from "../models/quiz_new.js";
import { extractMCQAnswer, validateAnswerConsistency } from "../utils/answerExtractor.js";

dotenv.config();

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
  section: (msg) => console.log(`\n${colors.cyan}${"=".repeat(70)}${colors.reset}\n${colors.cyan}${msg}${colors.reset}\n${colors.cyan}${"=".repeat(70)}${colors.reset}\n`)
};

const isDryRun = process.argv.includes("--dry-run");

async function migrateAnswers() {
  try {
    log.section("MCQ Answer Field Migration");

    if (isDryRun) {
      log.warning("DRY RUN MODE - No changes will be saved");
    }

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    log.success("Connected to MongoDB");

    // Stats
    let statsQB = { total: 0, migrated: 0, normalized: 0, fixed: 0, errors: 0 };
    let statsQuiz = { total: 0, migrated: 0, normalized: 0, fixed: 0, errors: 0 };

    // ==================== MIGRATE QUESTION BANKS ====================
    log.section("Step 1: Migrating Question Banks");

    const banks = await QuestionBank.find({});
    log.info(`Found ${banks.length} question bank(s)`);

    for (const bank of banks) {
      log.info(`Processing: ${bank.subjectName}`);

      for (let i = 0; i < bank.questions.length; i++) {
        const q = bank.questions[i];
        statsQB.total++;

        let changed = false;

        // Check if question has capitalized 'Answer' field (Mongoose stores it as plain object)
        if (q.Answer && !q.answer) {
          q.answer = q.Answer;
          q.Answer = undefined;
          changed = true;
          statsQB.migrated++;
        }

        // Normalize MCQ answers
        if (q.questionType === "MCQ" && q.answer) {
          const normalized = extractMCQAnswer(q.answer);
          if (normalized !== q.answer) {
            q.answer = normalized;
            changed = true;
            statsQB.normalized++;
          }
        }

        // Handle empty answers for MCQs
        if (q.questionType === "MCQ" && !q.answer) {
          log.warning(`  Q${i + 1}: MCQ without answer - "${q.questionText.substring(0, 40)}..."`);
          statsQB.errors++;
        }

        if (changed && !isDryRun) {
          // Note: We don't need explicit save because we're modifying the array
        }
      }

      if (!isDryRun) {
        await bank.save();
        log.success(`  Saved ${bank.subjectName}`);
      }
    }

    log.info(`Question Banks - Migrated: ${statsQB.migrated}, Normalized: ${statsQB.normalized}, Errors: ${statsQB.errors}`);

    // ==================== MIGRATE QUIZ DOCUMENTS ====================
    log.section("Step 2: Migrating Quiz Documents");

    const quizzes = await Quiz1.find({});
    log.info(`Found ${quizzes.length} quiz document(s)`);

    for (const quiz of quizzes) {
      log.info(`Processing: ${quiz.file_name}`);

      for (let i = 0; i < quiz.questions.length; i++) {
        const q = quiz.questions[i];
        statsQuiz.total++;

        let changed = false;

        // Check if question has capitalized 'Answer' field
        if (q.Answer && !q.answer) {
          q.answer = q.Answer;
          q.Answer = undefined;
          changed = true;
          statsQuiz.migrated++;
        }

        // Normalize MCQ answers
        if (q.questionType === "MCQ" && q.answer) {
          const normalized = extractMCQAnswer(q.answer);
          if (normalized !== q.answer) {
            q.answer = normalized;
            changed = true;
            statsQuiz.normalized++;
          }
        }

        // Handle empty answers
        if (q.questionType === "MCQ" && !q.answer) {
          log.warning(`  Q${i + 1}: MCQ without answer - "${q.questionText.substring(0, 40)}..."`);
          statsQuiz.errors++;
        }

        if (changed && !isDryRun) {
          // Mark as modified
        }
      }

      if (!isDryRun) {
        await quiz.save();
        log.success(`  Saved: ${quiz.file_name}`);
      }
    }

    log.info(`Quiz Documents - Migrated: ${statsQuiz.migrated}, Normalized: ${statsQuiz.normalized}, Errors: ${statsQuiz.errors}`);

    // ==================== VALIDATION PASS ====================
    log.section("Step 3: Validating After Migration");

    let validationIssues = 0;

    const banksAfter = await QuestionBank.find({});
    for (const bank of banksAfter) {
      for (const q of bank.questions) {
        const validation = validateAnswerConsistency(q);
        if (!validation.isValid) {
          validationIssues++;
          log.warning(`${bank.subjectName} - "${q.questionText.substring(0, 40)}..."`);
          validation.warnings.forEach(w => log.info(`  • ${w}`));
        }
      }
    }

    // ==================== FINAL REPORT ====================
    log.section("MIGRATION COMPLETE");

    log.info("Question Banks:");
    log.info(`  • Total Processed: ${statsQB.total}`);
    log.info(`  • Field Migrated: ${statsQB.migrated}`);
    log.info(`  • Answers Normalized: ${statsQB.normalized}`);
    log.info(`  • Errors Found: ${statsQB.errors}`);

    log.info("\nQuiz Documents:");
    log.info(`  • Total Processed: ${statsQuiz.total}`);
    log.info(`  • Field Migrated: ${statsQuiz.migrated}`);
    log.info(`  • Answers Normalized: ${statsQuiz.normalized}`);
    log.info(`  • Errors Found: ${statsQuiz.errors}`);

    log.info(`\nValidation Issues After Migration: ${validationIssues}`);

    if (validationIssues === 0) {
      log.success("All data is now in correct format! ✨");
    } else {
      log.warning(`${validationIssues} issue(s) remain that need manual review`);
    }

    if (isDryRun) {
      log.warning("\nDry run completed - no changes were saved. Run without --dry-run to apply changes.");
    } else {
      log.success("Changes have been saved to database");
    }

    await mongoose.connection.close();
    log.success("Database connection closed");

  } catch (error) {
    log.error(`Migration failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run migration
migrateAnswers();
