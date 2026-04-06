/**
 * MCQ Answer Auto-Fix Script
 * 
 * Automatically fixes common MCQ answer extraction issues:
 * 1. Normalizes lowercase letters to uppercase (b → B)
 * 2. Normalizes comma-separated answers (a,c → A,C)
 * 3. Removes extra spaces in answers (A , C → A,C)
 * 4. Removes invalid characters from MCQ answers
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Models
const Quiz1 = require('../models/quiz_new.js');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz_db';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
};

function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

function normalizeMCQAnswer(answer, questionType) {
  if (!answer || typeof answer !== 'string') return answer;
  
  // Only normalize MCQ answers
  if (questionType !== 'MCQ') return answer;

  let normalized = answer.trim();

  // Check if it's a single letter (a, b, c, d) or multiple (a,c)
  if (/^[a-dA-D](,[a-dA-D])*\s*$/.test(normalized)) {
    // Remove spaces around commas and convert to uppercase
    normalized = normalized
      .toUpperCase()
      .replace(/\s*,\s*/g, ',');
    
    // Deduplicate letters while preserving order
    const letters = normalized.split(',');
    const uniqueLetters = [...new Set(letters)];
    return uniqueLetters.join(',');
  }

  // If it contains any MCQ letters with extra characters, extract just the letters
  const letters = normalized.match(/[A-D]/gi);
  if (letters && letters.length > 0) {
    const uniqueLetters = [...new Set(letters.map(l => l.toUpperCase()))];
    return uniqueLetters.join(',');
  }

  return answer;
}

async function fixMCQAnswers(dryRun = true) {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const mode = dryRun ? 'DRY RUN' : 'LIVE';
    console.log(colorize(`\n=== MCQ Answer Auto-Fix (${mode}) ===\n`, colors.cyan));

    // Fetch all quizzes
    const quizzes = await Quiz1.find({});
    console.log(colorize(`Found ${quizzes.length} quiz(zes)\n`, colors.bright));

    let stats = {
      quizzesProcessed: 0,
      questionsProcessed: 0,
      mcqQuestionsProcessed: 0,
      fixesApplied: 0,
      changes: [],
    };

    for (const quiz of quizzes) {
      stats.quizzesProcessed++;
      const questions = quiz.questions || [];
      stats.questionsProcessed += questions.length;

      let quizModified = false;

      for (let idx = 0; idx < questions.length; idx++) {
        const q = questions[idx];
        const qtype = q.questionType || 'UNKNOWN';

        if (qtype !== 'MCQ') continue;

        stats.mcqQuestionsProcessed++;
        const originalAnswer = q.Answer || '';
        const normalizedAnswer = normalizeMCQAnswer(originalAnswer, qtype);

        if (originalAnswer !== normalizedAnswer) {
          stats.fixesApplied++;
          quizModified = true;
          q.Answer = normalizedAnswer;

          const change = {
            file: quiz.file_name,
            qnum: q.questionNumber || idx + 1,
            before: originalAnswer,
            after: normalizedAnswer,
          };
          stats.changes.push(change);

          console.log(
            colorize(`✏️  Q${change.qnum}:`, colors.yellow),
            `"${change.before}" → "${change.after}"`
          );
        }
      }

      // Save if not dry run and modified
      if (quizModified && !dryRun) {
        try {
          await quiz.save();
          console.log(
            colorize(`✅ Saved: ${quiz.file_name}`, colors.green)
          );
        } catch (saveError) {
          console.error(
            colorize(`❌ Failed to save ${quiz.file_name}:`, colors.red),
            saveError.message
          );
        }
      }
    }

    // Summary
    console.log(colorize('\n=== Summary ===\n', colors.cyan));
    console.log(`Quizzes Processed:        ${stats.quizzesProcessed}`);
    console.log(`Total Questions:          ${stats.questionsProcessed}`);
    console.log(`MCQ Questions:            ${stats.mcqQuestionsProcessed}`);
    console.log(
      colorize(`Fixes Applied:            ${stats.fixesApplied}`, colors.green)
    );

    if (stats.fixesApplied > 0) {
      console.log(colorize('\n=== Changes Log ===\n', colors.cyan));
      stats.changes.forEach((change) => {
        console.log(
          `${change.file} Q${change.qnum}: "${change.before}" → "${change.after}"`
        );
      });
    }

    if (dryRun && stats.fixesApplied > 0) {
      console.log(
        colorize(
          `\n💡 Dry run complete. Run with --apply flag to save changes.\n`,
          colors.yellow
        )
      );
    } else if (!dryRun) {
      console.log(
        colorize(`\n✅ All fixes applied and saved.\n`, colors.green)
      );
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error(colorize('\n❌ Error:', colors.red), error.message);
    process.exit(1);
  }
}

// Check command line args
const isDryRun = !process.argv.includes('--apply');
fixMCQAnswers(isDryRun);
