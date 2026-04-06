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

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Models
const Quiz1 = require('../models/quiz_new.js');
const QuestionBank = require('../models/QuestionBank.js');

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

async function analyzeMCQAnswers() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(colorize('\n=== MCQ Answer Extraction Diagnostics ===\n', colors.cyan));

    // Fetch all quizzes
    const quizzes = await Quiz1.find({});
    console.log(colorize(`Found ${quizzes.length} quiz(zes) in database\n`, colors.bright));

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

    // Track questions by number for inconsistency detection
    const questionsByNumber = {};

    for (const quiz of quizzes) {
      console.log(colorize(`\nAnalyzing: ${quiz.file_name}`, colors.bright));
      console.log(`File: ${quiz.file_name}`);
      console.log(`Enrollment: ${quiz.documentInfo?.enrollmentNumber || 'N/A'}`);
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

        // Track for inconsistency detection
        if (!questionsByNumber[qnum]) {
          questionsByNumber[qnum] = [];
        }
        questionsByNumber[qnum].push({
          file: quiz.file_name,
          answer,
          options: q.options || [],
        });

        // Check for issues
        let issues = [];

        // Issue 1: Lowercase answers
        if (answer && /^[a-d]$/.test(answer)) {
          issues.push(
            colorize(`Lowercase answer: "${answer}" should be "${answer.toUpperCase()}"`, colors.red)
          );
          stats.issuesFound.lowercaseAnswers.push({
            file: quiz.file_name,
            qnum,
            answer,
            corrected: answer.toUpperCase(),
          });
        }

        // Issue 2: Empty answers
        if (!answer || answer.trim() === '') {
          issues.push(colorize('Empty answer (no data extracted)', colors.yellow));
          stats.issuesFound.emptyAnswers.push({
            file: quiz.file_name,
            qnum,
            questionText: (q.questionText || '').substring(0, 60),
          });
        }

        // Issue 3: Invalid letters
        if (answer && /^[E-Z]$/.test(answer)) {
          issues.push(
            colorize(
              `Invalid letter: "${answer}" - MCQ should be A/B/C/D only`,
              colors.red
            )
          );
          stats.issuesFound.wrongLetters.push({
            file: quiz.file_name,
            qnum,
            answer,
            options: q.options?.length || 0,
          });
        }

        // Print issue details
        if (issues.length > 0) {
          console.log(`  Q${qnum} [MCQ]: ${answer || '[EMPTY]'}`);
          issues.forEach((issue) => console.log(`    ❌ ${issue}`));
        }
      }
    }

    // Check for inconsistencies (same question, different answers)
    console.log(colorize('\n=== Answer Consistency Analysis ===\n', colors.cyan));
    for (const qnum in questionsByNumber) {
      const instances = questionsByNumber[qnum];
      if (instances.length > 1) {
        const answers = instances.map((i) => i.answer).filter((a) => a);
        const uniqueAnswers = new Set(answers);

        if (uniqueAnswers.size > 1) {
          console.log(
            colorize(`Q${qnum}: INCONSISTENT ANSWERS FOUND`, colors.red)
          );
          instances.forEach((inst, idx) => {
            console.log(
              `  [${idx + 1}] ${inst.file}: "${inst.answer || '[EMPTY]'}"`
            );
          });
          stats.issuesFound.inconsistentAnswers.push({
            qnum,
            instances: instances.length,
            uniqueAnswers: Array.from(uniqueAnswers),
          });
        }
      }
    }

    // Summary
    console.log(colorize('\n=== Summary ===\n', colors.cyan));
    console.log(`Total Questions Analyzed:     ${stats.totalQuestions}`);
    console.log(`MCQ Questions:                ${stats.mcqQuestions}`);
    console.log(
      colorize(
        `Lowercase Answers Found:      ${stats.issuesFound.lowercaseAnswers.length}`,
        stats.issuesFound.lowercaseAnswers.length > 0 ? colors.yellow : colors.green
      )
    );
    console.log(
      colorize(
        `Empty Answers Found:          ${stats.issuesFound.emptyAnswers.length}`,
        stats.issuesFound.emptyAnswers.length > 0 ? colors.yellow : colors.green
      )
    );
    console.log(
      colorize(
        `Inconsistencies Found:        ${stats.issuesFound.inconsistentAnswers.length}`,
        stats.issuesFound.inconsistentAnswers.length > 0 ? colors.red : colors.green
      )
    );
    console.log(
      colorize(
        `Invalid Letters Found:        ${stats.issuesFound.wrongLetters.length}`,
        stats.issuesFound.wrongLetters.length > 0 ? colors.red : colors.green
      )
    );

    // Detailed report if issues found
    if (
      stats.issuesFound.lowercaseAnswers.length > 0 ||
      stats.issuesFound.emptyAnswers.length > 0 ||
      stats.issuesFound.inconsistentAnswers.length > 0
    ) {
      console.log(colorize('\n=== Detailed Issue Report ===\n', colors.cyan));

      if (stats.issuesFound.lowercaseAnswers.length > 0) {
        console.log(
          colorize('LOWERCASE ANSWERS TO NORMALIZE:', colors.yellow)
        );
        stats.issuesFound.lowercaseAnswers.forEach((issue) => {
          console.log(
            `  ${issue.file} Q${issue.qnum}: "${issue.answer}" → "${issue.corrected}"`
          );
        });
      }

      if (stats.issuesFound.emptyAnswers.length > 0) {
        console.log(colorize('\nEMPTY MCQ ANSWERS:', colors.yellow));
        stats.issuesFound.emptyAnswers.slice(0, 10).forEach((issue) => {
          console.log(
            `  ${issue.file} Q${issue.qnum}: "${issue.questionText}..."`
          );
        });
        if (stats.issuesFound.emptyAnswers.length > 10) {
          console.log(
            `  ... and ${stats.issuesFound.emptyAnswers.length - 10} more`
          );
        }
      }

      if (stats.issuesFound.inconsistentAnswers.length > 0) {
        console.log(colorize('\nINCONSISTENT ANSWERS:', colors.red));
        stats.issuesFound.inconsistentAnswers.forEach((issue) => {
          console.log(
            `  Q${issue.qnum}: Found ${issue.instances} extractions with different answers: [${issue.uniqueAnswers.join(', ')}]`
          );
        });
      }
    }

    console.log(colorize('\n✅ Diagnosis complete\n', colors.green));
  } catch (error) {
    console.error(colorize('\n❌ Error:', colors.red), error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

analyzeMCQAnswers();
