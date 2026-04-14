import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Models
import Quiz1 from '../models/quiz_new.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/quiz_db';

// Colors
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

  if (questionType !== 'MCQ') return answer;

  let normalized = answer.trim();

  if (/^[a-dA-D](,[a-dA-D])*\s*$/.test(normalized)) {
    normalized = normalized
      .toUpperCase()
      .replace(/\s*,\s*/g, ',');

    const letters = normalized.split(',');
    const uniqueLetters = [...new Set(letters)];
    return uniqueLetters.join(',');
  }

  const letters = normalized.match(/[A-D]/gi);
  if (letters && letters.length > 0) {
    const uniqueLetters = [...new Set(letters.map(l => l.toUpperCase()))];
    return uniqueLetters.join(',');
  }

  return answer;
}

async function fixMCQAnswers(dryRun = true) {
  try {
    await mongoose.connect(MONGODB_URI);

    const mode = dryRun ? 'DRY RUN' : 'LIVE';
    console.log(colorize(`\n=== MCQ Answer Auto-Fix (${mode}) ===\n`, colors.cyan));

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
            colorize(`✏️ Q${change.qnum}:`, colors.yellow),
            `"${change.before}" → "${change.after}"`
          );
        }
      }

      if (quizModified && !dryRun) {
        try {
          await quiz.save();
          console.log(colorize(`✅ Saved: ${quiz.file_name}`, colors.green));
        } catch (err) {
          console.error(
            colorize(`❌ Save failed:`, colors.red),
            err.message
          );
        }
      }
    }

    // Summary
    console.log(colorize('\n=== Summary ===\n', colors.cyan));
    console.log(`Quizzes Processed: ${stats.quizzesProcessed}`);
    console.log(`Total Questions:   ${stats.questionsProcessed}`);
    console.log(`MCQ Questions:     ${stats.mcqQuestionsProcessed}`);
    console.log(
      colorize(`Fixes Applied:     ${stats.fixesApplied}`, colors.green)
    );

    if (stats.fixesApplied > 0) {
      console.log(colorize('\n=== Changes ===\n', colors.cyan));
      stats.changes.forEach((c) => {
        console.log(`${c.file} Q${c.qnum}: "${c.before}" → "${c.after}"`);
      });
    }

    if (dryRun && stats.fixesApplied > 0) {
      console.log(
        colorize(`\n💡 Run with --apply to save changes\n`, colors.yellow)
      );
    } else if (!dryRun) {
      console.log(colorize(`\n✅ Changes saved\n`, colors.green));
    }

  } catch (err) {
    console.error(colorize('❌ Error:', colors.red), err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// CLI flag
const isDryRun = !process.argv.includes('--apply');
fixMCQAnswers(isDryRun);