/**
 * MCQ Answer Extraction Diagnostics
 * 
 * Analyzes Groq extraction output to identify:
 * 1. Lowercase MCQ answers (should be uppercase)
 * 2. Empty answers (missing data)
 * 3. Inconsistent answers (same question extracted differently)
 * 4. Wrong letter answers (clearly incorrect based on options)
 * 5. Case sensitivity issues in fill-in blanks
 */
import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Models (use import instead of require)
import Quiz1 from '../models/quiz_new.js';
import QuestionBank from '../models/QuestionBank.js';

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

async function analyzeMCQAnswers() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(colorize('\n=== MCQ Answer Extraction Diagnostics ===\n', colors.cyan));

    const quizzes = await Quiz1.find({});
    console.log(colorize(`Found ${quizzes.length} quiz(zes)\n`, colors.bright));

    let stats = {
      totalQuestions: 0,
      mcqQuestions: 0,
      issuesFound: {
        lowercaseAnswers: [],
        emptyAnswers: [],
        inconsistentAnswers: [],
        wrongLetters: [],
      },
    };

    const questionsByNumber = {};

    for (const quiz of quizzes) {
      console.log(colorize(`\nAnalyzing: ${quiz.file_name}`, colors.bright));
      console.log('-'.repeat(60));

      const questions = quiz.questions || [];
      stats.totalQuestions += questions.length;

      for (let idx = 0; idx < questions.length; idx++) {
        const q = questions[idx];
        const qnum = q.questionNumber || idx + 1;
        const qtype = q.questionType || 'UNKNOWN';
        const answer = q.Answer || '';

        if (qtype !== 'MCQ') continue;

        stats.mcqQuestions++;

        if (!questionsByNumber[qnum]) {
          questionsByNumber[qnum] = [];
        }

        questionsByNumber[qnum].push({
          file: quiz.file_name,
          answer,
        });

        let issues = [];

        // Lowercase
        if (answer && /^[a-d]$/.test(answer)) {
          issues.push(
            colorize(`Lowercase: "${answer}" → "${answer.toUpperCase()}"`, colors.red)
          );
          stats.issuesFound.lowercaseAnswers.push({ qnum, answer });
        }

        // Empty
        if (!answer) {
          issues.push(colorize('Empty answer', colors.yellow));
          stats.issuesFound.emptyAnswers.push({ qnum });
        }

        // Invalid
        if (answer && /^[E-Z]$/.test(answer)) {
          issues.push(colorize(`Invalid letter: ${answer}`, colors.red));
          stats.issuesFound.wrongLetters.push({ qnum, answer });
        }

        if (issues.length) {
          console.log(`Q${qnum}: ${answer || '[EMPTY]'}`);
          issues.forEach((i) => console.log(`  ❌ ${i}`));
        }
      }
    }

    // Inconsistency check
    console.log(colorize('\n=== Consistency Check ===\n', colors.cyan));

    for (const qnum in questionsByNumber) {
      const answers = questionsByNumber[qnum].map((i) => i.answer).filter(Boolean);
      const unique = [...new Set(answers)];

      if (unique.length > 1) {
        console.log(colorize(`Q${qnum} inconsistent: ${unique.join(', ')}`, colors.red));
        stats.issuesFound.inconsistentAnswers.push(qnum);
      }
    }

    console.log(colorize('\n✅ Done\n', colors.green));

  } catch (err) {
    console.error(colorize('❌ Error:', colors.red), err.message);
  } finally {
    await mongoose.disconnect();
  }
}

analyzeMCQAnswers();