import axios from "axios";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Subject from "../models/Subject.js";
import Upload from "../models/Upload.js";
import SubjectQuiz from "../models/SubjectQuiz.js";
import { addToQuestionBank } from "./questionBankController.js";

// Helper function to mask enrollment number (hide last 5 digits)
const maskEnrollment = (enrollment) => {
  if (!enrollment) return enrollment;
  const str = enrollment.toString();
  if (str.length <= 5) return '*'.repeat(str.length);
  return str.slice(0, -5) + '*****';
};

// Landing AI API Key - from environment or fallback
const VA_API_KEY = process.env.LANDING_AI_API_KEY ||
  "bnoxd3ozb2VsanV2OHZoNTJuc3g2Om1CWXRlVzVYeUh5bEdQa28yajdZcWs2VUNiSU5uY0hw";


// Processed folder path
const PROCESSED_FOLDER_PATH = path.resolve(process.cwd(), "processed_uploads");

// Create processed folder if missing
if (!fs.existsSync(PROCESSED_FOLDER_PATH)) {
  fs.mkdirSync(PROCESSED_FOLDER_PATH, { recursive: true });
}

// Schema for Landing AI extraction
const schemaContent = {
  type: "object",
  title: "Quiz Extraction Schema",
  properties: {
    documentInfo: {
      type: "object",
      description: "Core metadata and identifiers for the document.",
      properties: {
        enrollmentNumber: {
          type: "number",
          default: 0,
          description: "The enrollment number associated with the document.",
        },
        date: {
          type: "string",
          description: "The date when the document or quiz was issued.",
        },
        totalMarks: {
          type: "number",
          description: "The total marks for the quiz or assessment.",
        },
      },
      required: ["enrollmentNumber", "date"],
    },
    questions: {
      type: "array",
      description: "List of questions with options and selected answers.",
      items: {
        type: "object",
        properties: {
          questionText: {
            type: "string",
            description: "The text of the question.",
          },
          questionType: {
            type: "string",
            description: "The type of the question.",
          },
          marks: {
            type: "number",
            description: "Marks allocated for the question.",
          },
          options: {
            type: "array",
            description: "List of possible answer options.",
            items: {
              type: "string",
            },
          },
          Answer: {
            type: "string",
            description: "All correct answers, concatenated into a single string, separated by a comma and space.",
          },
        },
        required: ["questionText"],
      },
    },
  },
  required: ["documentInfo", "questions"],
};

// Get all subjects
export const getAllSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ name: 1 });
    res.status(200).json({
      success: true,
      count: subjects.length,
      data: subjects
    });
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch subjects",
      details: error.message
    });
  }
};

// Create a new subject
export const createSubject = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Subject name is required"
      });
    }

    // Check if subject already exists
    const existingSubject = await Subject.findOne({ name: name.toUpperCase() });
    if (existingSubject) {
      return res.status(400).json({
        success: false,
        error: "Subject already exists",
        data: existingSubject
      });
    }

    const subject = new Subject({
      name: name.toUpperCase(),
      description: description || ''
    });

    await subject.save();

    res.status(201).json({
      success: true,
      message: "Subject created successfully",
      data: subject
    });
  } catch (error) {
    console.error("Error creating subject:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create subject",
      details: error.message
    });
  }
};

// Get uploads by subject
export const getUploadsBySubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const uploads = await Upload.find({ subjectId })
      .sort({ createdAt: -1 })
      .populate('subjectId', 'name');

    res.status(200).json({
      success: true,
      count: uploads.length,
      data: uploads
    });
  } catch (error) {
    console.error("Error fetching uploads:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch uploads",
      details: error.message
    });
  }
};

// Process a single file with Landing AI
const processFileWithLandingAI = async (filePath, fileName) => {
  // STEP 1: Parse document
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

  if (!markdown) {
    throw new Error("No markdown returned from parse API");
  }

  // STEP 2: Extract structured data
  const formExtract = new FormData();
  formExtract.append("markdown", markdown);
  formExtract.append("schema", JSON.stringify(schemaContent));

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

  return extractResponse.data.extraction || {};
};



// Upload and process files for a specific subject
export const uploadAndProcessFiles = async (req, res) => {
  const { subjectId } = req.params;
  const files = req.files;
  // Option to add all questions to bank (not just answer keys with enrollment 0)
  const addAllToBank = req.body.addAllToBank === 'true' || req.body.addAllToBank === true;
  // API choice: "landing" or "gemini" (default: landing)
  const extractorAPI = req.body.extractorAPI || req.body.api || "landing";

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: "No files uploaded"
    });
  }

  try {
    // Verify subject exists
    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        error: "Subject not found"
      });
    }

    console.log(`📡 Using ${extractorAPI.toUpperCase()} API for extraction`);

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let questionsAdded = 0;

    for (const file of files) {
      const filePath = file.path;
      const fileName = file.originalname;
      const fileExt = path.extname(fileName).toLowerCase().replace('.', '');

      // Create upload record
      const uploadRecord = new Upload({
        subjectId: subject._id,
        subjectName: subject.name,
        filename: file.filename,
        originalName: fileName,
        fileType: fileExt,
        fileSize: file.size,
        status: 'processing',
        extractorAPI: extractorAPI
      });

      try {
        console.log(`🔄 Processing: ${fileName} for subject: ${subject.name} [${extractorAPI.toUpperCase()}]`);

        // Process with selected API
        let extraction;
        if (extractorAPI === "gemini") {
          extraction = await processFileWithGemini(filePath, fileName);
        } else {
          extraction = await processFileWithLandingAI(filePath, fileName);
        }

        // Update upload record with extracted data
        uploadRecord.extractedData = {
          documentInfo: extraction.documentInfo || {},
          questions: extraction.questions || []
        };
        uploadRecord.questionCount = extraction.questions?.length || 0;
        uploadRecord.status = 'completed';
        uploadRecord.processedAt = new Date();

        await uploadRecord.save();

        // Add to question bank
        const enrollmentNumber = extraction.documentInfo?.enrollmentNumber;
        const shouldAddToBank = addAllToBank || enrollmentNumber === 0;

        if (extraction.questions && extraction.questions.length > 0 && shouldAddToBank) {
          const bankResult = await addToQuestionBank(
            subject.name,
            extraction.questions,
            fileName
          );
          questionsAdded += bankResult.addedCount || 0;
          console.log(`📚 Question Bank: ${bankResult.message}`);
        } else if (!shouldAddToBank) {
          console.log(`📝 Student sheet (enrollment: ${enrollmentNumber}) - skipped for question bank`);
        }

        // Move file to processed folder
        const subjectFolder = path.join(PROCESSED_FOLDER_PATH, subject.name);
        if (!fs.existsSync(subjectFolder)) {
          fs.mkdirSync(subjectFolder, { recursive: true });
        }
        const newFilePath = path.join(subjectFolder, fileName);
        fs.renameSync(filePath, newFilePath);

        successCount++;
        results.push({
          fileName,
          status: 'success',
          questionCount: uploadRecord.questionCount,
          documentInfo: extraction.documentInfo,
          uploadId: uploadRecord._id
        });

        console.log(`✅ Completed: ${fileName}`);

      } catch (fileError) {
        console.error(`❌ Failed: ${fileName}`, fileError.message);

        uploadRecord.status = 'failed';
        uploadRecord.errorMessage = fileError.message;
        await uploadRecord.save();

        failCount++;
        results.push({
          fileName,
          status: 'failed',
          error: fileError.message
        });

        // Clean up failed file
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Update subject stats
    subject.totalUploads += successCount;
    subject.totalQuestions += questionsAdded;
    await subject.save();

    res.status(200).json({
      success: true,
      message: `Processed ${successCount}/${files.length} files for ${subject.name}`,
      subject: subject.name,
      stats: {
        total: files.length,
        success: successCount,
        failed: failCount,
        questionsAdded
      },
      results
    });

  } catch (error) {
    console.error("Upload processing error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process uploads",
      details: error.message
    });
  }
};

// Delete a subject and its uploads
export const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await Subject.findById(subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        error: "Subject not found"
      });
    }

    // Delete all uploads for this subject
    await Upload.deleteMany({ subjectId });

    // Delete the subject
    await Subject.findByIdAndDelete(subjectId);

    res.status(200).json({
      success: true,
      message: `Subject "${subject.name}" and all its uploads deleted`
    });
  } catch (error) {
    console.error("Error deleting subject:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete subject",
      details: error.message
    });
  }
};

// Get upload details
export const getUploadDetails = async (req, res) => {
  try {
    const { uploadId } = req.params;

    const upload = await Upload.findById(uploadId).populate('subjectId', 'name');

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: "Upload not found"
      });
    }

    res.status(200).json({
      success: true,
      data: upload
    });
  } catch (error) {
    console.error("Error fetching upload:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch upload details",
      details: error.message
    });
  }
};

// ==================== QUIZ-BASED UPLOAD SYSTEM ====================

/**
 * Helper: Find or create a quiz within a subject
 */
const findOrCreateQuiz = (subject, quizName) => {
  // Try to find existing quiz
  let quiz = subject.quizzes.find(
    q => q.quizName.toLowerCase() === quizName.toLowerCase()
  );

  if (!quiz) {
    // Create new quiz
    const quizNumber = subject.quizzes.length + 1;
    subject.quizzes.push({
      quizName: quizName,
      quizNumber: quizNumber,
      description: '',
      questions: [],
      attempts: [],
      isActive: true
    });
    quiz = subject.quizzes[subject.quizzes.length - 1];
  }

  return quiz;
};

/**
 * Helper: Evaluate student answers against answer key
 */
const evaluateStudentAnswers = (studentAnswers, answerKey) => {
  let totalMarks = 0;
  let obtainedMarks = 0;

  const evaluatedAnswers = studentAnswers.map((sa, idx) => {
    const questionNum = sa.questionNumber || idx + 1;
    const keyQuestion = answerKey.find(q => q.questionNumber === questionNum);

    if (!keyQuestion) {
      return {
        questionNumber: questionNum,
        studentAnswer: sa.studentAnswer || sa.Answer || '',
        correctAnswer: 'N/A',
        isCorrect: false,
        marksObtained: 0,
        maxMarks: 1
      };
    }

    const studentAns = (sa.studentAnswer || sa.Answer || '').toString().toLowerCase().trim();
    const correctAns = (keyQuestion.correctAnswer || '').toString().toLowerCase().trim();

    // Check if correct (handle multiple correct answers separated by comma)
    const correctOptions = correctAns.split(',').map(a => a.trim());
    const isCorrect = correctOptions.some(opt => opt === studentAns);

    const marks = keyQuestion.marks || 1;
    totalMarks += marks;

    const marksObtained = isCorrect ? marks : 0;
    obtainedMarks += marksObtained;

    return {
      questionNumber: questionNum,
      studentAnswer: sa.studentAnswer || sa.Answer || '',
      correctAnswer: keyQuestion.correctAnswer,
      isCorrect,
      marksObtained,
      maxMarks: marks
    };
  });

  const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : 0;
  const grade = getGrade(percentage);

  return {
    answers: evaluatedAnswers,
    totalMarks,
    obtainedMarks,
    percentage,
    grade
  };
};

/**
 * Helper: Get grade from percentage
 */
const getGrade = (percentage) => {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
};

/**
 * Upload and process files for a specific QUIZ within a subject
 * Accepts: quizName (e.g., "Quiz 1", "Quiz 2") to identify which quiz
 */
export const uploadToQuiz = async (req, res) => {
  const { subjectId } = req.params;
  const files = req.files;
  const quizName = req.body.quizName || req.body.quiz || "Quiz 1";
  const extractorAPI = req.body.extractorAPI || req.body.api || "gemini";

  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: "No files uploaded"
    });
  }

  try {
    // Find subject in SubjectQuiz model
    let subject = await SubjectQuiz.findById(subjectId);

    if (!subject) {
      // Try finding by name if ID fails
      subject = await SubjectQuiz.findOne({ name: subjectId.toUpperCase() });
    }

    if (!subject) {
      return res.status(404).json({
        success: false,
        error: "Subject not found. Create a subject first."
      });
    }

    // Find or create the specified quiz
    const quiz = findOrCreateQuiz(subject, quizName);
    console.log(`📋 Processing for: ${subject.name} → ${quiz.quizName}`);

    const results = {
      answerKeys: [],
      studentSheets: [],
      failed: []
    };

    for (const file of files) {
      const filePath = file.path;
      const fileName = file.originalname;

      try {
        console.log(`🔄 Processing: ${fileName}`);

        // Extract data using selected API
        let extraction;
        if (extractorAPI === "gemini") {
          extraction = await processFileWithGemini(filePath, fileName);
        } else {
          extraction = await processFileWithLandingAI(filePath, fileName);
        }

        const enrollmentNumber = extraction.documentInfo?.enrollmentNumber;
        const questions = extraction.questions || [];

        if (enrollmentNumber === 0 || !enrollmentNumber) {
          // This is an ANSWER KEY
          console.log(`📚 Answer Key detected: ${fileName}`);

          // Format and store questions
          const formattedQuestions = questions.map((q, idx) => ({
            questionNumber: idx + 1,
            questionText: q.questionText || `Question ${idx + 1}`,
            questionType: q.questionType || 'MCQ',
            options: q.options || [],
            correctAnswer: q.Answer || q.correctAnswer || '',
            marks: q.marks || 1,
            difficulty: 'MEDIUM' // Will be calculated after attempts
          }));

          // Replace or merge questions
          if (quiz.questions.length === 0) {
            quiz.questions = formattedQuestions;
          } else {
            // Merge new questions
            formattedQuestions.forEach(newQ => {
              const existing = quiz.questions.find(q => q.questionNumber === newQ.questionNumber);
              if (!existing) {
                quiz.questions.push(newQ);
              }
            });
          }

          quiz.answerKeyFile = fileName;

          // Add to question bank
          formattedQuestions.forEach(q => {
            const existing = subject.questionBank.find(
              qb => qb.questionText && q.questionText &&
                qb.questionText.toLowerCase() === q.questionText.toLowerCase()
            );
            if (existing) {
              existing.frequency += 1;
            } else if (q.questionText) {
              subject.questionBank.push({
                questionText: q.questionText,
                correctAnswer: q.correctAnswer,
                marks: q.marks,
                difficulty: 'MEDIUM',
                frequency: 1
              });
            }
          });

          results.answerKeys.push({
            fileName,
            questionsCount: formattedQuestions.length,
            status: 'success'
          });

        } else {
          // This is a STUDENT ANSWER SHEET
          console.log(`📝 Student Sheet: ${fileName} (Enrollment: ${enrollmentNumber})`);

          // Check if already submitted
          const existingAttempt = quiz.attempts.find(
            a => a.enrollmentNumber === enrollmentNumber.toString()
          );

          if (existingAttempt) {
            console.log(`⚠️ Duplicate attempt for ${enrollmentNumber}, skipping`);
            results.failed.push({
              fileName,
              error: `Duplicate submission for enrollment ${enrollmentNumber}`
            });
            continue;
          }

          // Format student answers
          const studentAnswers = questions.map((q, idx) => ({
            questionNumber: idx + 1,
            studentAnswer: q.Answer || q.correctAnswer || '',
            isCorrect: false,
            marksObtained: 0
          }));

          // Evaluate if answer key exists
          let evaluation = null;
          if (quiz.questions.length > 0) {
            evaluation = evaluateStudentAnswers(studentAnswers, quiz.questions);
          }

          // Create attempt record
          const attempt = {
            enrollmentNumber: enrollmentNumber.toString(),
            studentName: '',
            answers: evaluation ? evaluation.answers : studentAnswers,
            totalMarks: evaluation ? evaluation.totalMarks : 0,
            obtainedMarks: evaluation ? evaluation.obtainedMarks : 0,
            percentage: evaluation ? evaluation.percentage : 0,
            grade: evaluation ? evaluation.grade : 'F',
            status: evaluation ? 'EVALUATED' : 'PENDING',
            submittedAt: new Date(),
            evaluatedAt: evaluation ? new Date() : null
          };

          quiz.attempts.push(attempt);

          results.studentSheets.push({
            fileName,
            enrollmentNumber,
            answersCount: studentAnswers.length,
            status: evaluation ? 'evaluated' : 'pending',
            result: evaluation ? {
              obtainedMarks: evaluation.obtainedMarks,
              totalMarks: evaluation.totalMarks,
              percentage: evaluation.percentage,
              grade: evaluation.grade
            } : null
          });
        }

        // Move file to processed folder
        const subjectFolder = path.join(PROCESSED_FOLDER_PATH, subject.name, quiz.quizName.replace(/\s+/g, '_'));
        if (!fs.existsSync(subjectFolder)) {
          fs.mkdirSync(subjectFolder, { recursive: true });
        }
        fs.renameSync(filePath, path.join(subjectFolder, fileName));

      } catch (fileError) {
        console.error(`❌ Failed: ${fileName}`, fileError.message);
        results.failed.push({
          fileName,
          error: fileError.message
        });

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }

    // Save subject with updated quiz
    await subject.save();

    // Calculate difficulty analysis if we have attempts
    const difficultyAnalysis = calculateQuizDifficulty(quiz);

    res.status(200).json({
      success: true,
      message: `Processed ${files.length} files for ${subject.name} - ${quiz.quizName}`,
      subject: subject.name,
      quiz: quiz.quizName,
      quizId: quiz._id,
      results: {
        answerKeys: results.answerKeys.length,
        studentSheets: results.studentSheets.length,
        failed: results.failed.length,
        details: results
      },
      quizStats: {
        totalQuestions: quiz.questions.length,
        totalAttempts: quiz.attempts.length,
        evaluatedAttempts: quiz.attempts.filter(a => a.status === 'EVALUATED').length
      },
      analytics: quiz.analytics,
      difficultyAnalysis
    });

  } catch (error) {
    console.error("Upload to quiz error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process uploads",
      details: error.message
    });
  }
};

/**
 * Evaluate all pending attempts for a quiz
 */
export const evaluateQuizAttempts = async (req, res) => {
  const { subjectId, quizId } = req.params;

  try {
    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    if (quiz.questions.length === 0) {
      return res.status(400).json({ success: false, error: "No answer key uploaded for this quiz" });
    }

    const pendingAttempts = quiz.attempts.filter(a => a.status === 'PENDING');

    if (pendingAttempts.length === 0) {
      return res.status(400).json({ success: false, error: "No pending attempts to evaluate" });
    }

    // Evaluate each pending attempt
    pendingAttempts.forEach(attempt => {
      const evaluation = evaluateStudentAnswers(attempt.answers, quiz.questions);
      attempt.answers = evaluation.answers;
      attempt.totalMarks = evaluation.totalMarks;
      attempt.obtainedMarks = evaluation.obtainedMarks;
      attempt.percentage = evaluation.percentage;
      attempt.grade = evaluation.grade;
      attempt.status = 'EVALUATED';
      attempt.evaluatedAt = new Date();
    });

    await subject.save();

    // Calculate difficulty
    const difficultyAnalysis = calculateQuizDifficulty(quiz);

    // Update question difficulties based on accuracy
    updateQuestionDifficulties(quiz);
    await subject.save();

    res.json({
      success: true,
      message: `Evaluated ${pendingAttempts.length} attempts`,
      quiz: quiz.quizName,
      analytics: quiz.analytics,
      difficultyAnalysis,
      results: quiz.attempts
        .filter(a => a.status === 'EVALUATED')
        .map(a => ({
          enrollmentNumber: maskEnrollment(a.enrollmentNumber),
          obtainedMarks: a.obtainedMarks,
          totalMarks: a.totalMarks,
          percentage: a.percentage,
          grade: a.grade
        }))
        .sort((a, b) => b.percentage - a.percentage)
    });

  } catch (error) {
    console.error("Evaluate quiz error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==================== DIFFICULTY ANALYSIS ====================

/**
 * Calculate difficulty analysis for a quiz based on student performance
 */
const calculateQuizDifficulty = (quiz) => {
  const evaluatedAttempts = quiz.attempts.filter(a => a.status === 'EVALUATED');

  if (evaluatedAttempts.length === 0) {
    return {
      status: 'insufficient_data',
      message: 'No evaluated attempts yet'
    };
  }

  // Overall quiz stats
  const percentages = evaluatedAttempts.map(a => a.percentage);
  const avgPercentage = percentages.reduce((a, b) => a + b, 0) / percentages.length;
  const variance = percentages.reduce((sum, p) => sum + Math.pow(p - avgPercentage, 2), 0) / percentages.length;
  const stdDev = Math.sqrt(variance);

  // Question-wise analysis - Step 1: Collect accuracy data
  const questionData = [];
  quiz.questions.forEach((question, idx) => {
    const questionNum = question.questionNumber || idx + 1;
    let correctCount = 0;
    let totalAttempts = 0;

    evaluatedAttempts.forEach(attempt => {
      const answer = attempt.answers.find(a => a.questionNumber === questionNum);
      if (answer) {
        totalAttempts++;
        if (answer.isCorrect) correctCount++;
      }
    });

    const accuracy = totalAttempts > 0 ? (correctCount / totalAttempts) * 100 : 0;
    questionData.push({
      questionNumber: questionNum,
      questionText: question.questionText?.substring(0, 50) + '...',
      correctCount,
      totalAttempts,
      accuracy,
      marks: question.marks
    });
  });

  // Step 2: Calculate Mean (μ) and Standard Deviation (σ) for question accuracies
  const accuracies = questionData.map(q => q.accuracy);
  const mean = accuracies.length > 0 ? accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length : 0;
  const accVariance = accuracies.length > 0 ? accuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / accuracies.length : 0;
  const accStdDev = Math.sqrt(accVariance);

  // Step 3: Classify using Normal Distribution Zones
  // Easy: x ≥ μ (top 50%), Medium: μ - σ ≤ x < μ (~34.1%), Hard: x < μ - σ (bottom ~15.9%)
  const questionStats = questionData.map(q => {
    let difficulty;
    if (q.accuracy >= mean) difficulty = 'EASY';
    else if (q.accuracy >= (mean - accStdDev)) difficulty = 'MEDIUM';
    else difficulty = 'HARD';

    return { ...q, accuracy: Math.round(q.accuracy * 100) / 100, difficulty };
  });

  // Calculate overall difficulty using the same μ/σ logic
  const avgAccuracy = mean;
  let overallDifficulty;
  if (avgAccuracy >= mean) overallDifficulty = 'EASY';
  else if (avgAccuracy >= (mean - accStdDev)) overallDifficulty = 'MEDIUM';
  else overallDifficulty = 'HARD';

  // Quiz Intelligence Score (QIS)
  const difficultyIndex = 1 - (avgAccuracy / 100);
  const QIS = (avgAccuracy * 0.6) + ((100 - Math.min(stdDev * 2, 100)) * 0.3) + ((1 - difficultyIndex) * 100 * 0.1);

  // Count by difficulty
  const difficultyDistribution = {
    easy: questionStats.filter(q => q.difficulty === 'EASY').length,
    medium: questionStats.filter(q => q.difficulty === 'MEDIUM').length,
    hard: questionStats.filter(q => q.difficulty === 'HARD').length
  };

  // Most difficult questions (lowest accuracy)
  const hardestQuestions = [...questionStats]
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);

  // Easiest questions (highest accuracy)
  const easiestQuestions = [...questionStats]
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5);

  return {
    status: 'analyzed',
    totalAttempts: evaluatedAttempts.length,
    overallStats: {
      averagePercentage: Math.round(avgPercentage * 100) / 100,
      standardDeviation: Math.round(stdDev * 100) / 100,
      averageAccuracy: Math.round(avgAccuracy * 100) / 100,
      difficultyIndex: Math.round(difficultyIndex * 1000) / 1000,
      overallDifficulty,
      QIS: Math.round(QIS * 100) / 100
    },
    difficultyDistribution,
    questionStats,
    hardestQuestions,
    easiestQuestions,
    insights: generateInsights(avgAccuracy, stdDev, difficultyDistribution, evaluatedAttempts.length)
  };
};

/**
 * Update question difficulties based on actual performance using μ/σ-based zones
 */
const updateQuestionDifficulties = (quiz) => {
  const evaluatedAttempts = quiz.attempts.filter(a => a.status === 'EVALUATED');

  if (evaluatedAttempts.length < 3) return; // Need at least 3 attempts for meaningful data

  // Step 1: Collect accuracy data for all questions
  const questionAccuracies = quiz.questions.map((question, idx) => {
    const questionNum = question.questionNumber || idx + 1;
    let correctCount = 0;
    let totalAttempts = 0;

    evaluatedAttempts.forEach(attempt => {
      const answer = attempt.answers.find(a => a.questionNumber === questionNum);
      if (answer) {
        totalAttempts++;
        if (answer.isCorrect) correctCount++;
      }
    });

    return totalAttempts > 0 ? (correctCount / totalAttempts) * 100 : 50;
  });

  // Step 2: Calculate Mean (μ) and Standard Deviation (σ)
  const mean = questionAccuracies.reduce((sum, acc) => sum + acc, 0) / questionAccuracies.length;
  const variance = questionAccuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / questionAccuracies.length;
  const stdDev = Math.sqrt(variance);

  // Step 3: Classify using Normal Distribution Zones
  // Easy: x ≥ μ (top 50%), Medium: μ - σ ≤ x < μ (~34.1%), Hard: x < μ - σ (bottom ~15.9%)
  quiz.questions.forEach((question, idx) => {
    const accuracy = questionAccuracies[idx];
    if (accuracy >= mean) question.difficulty = 'EASY';
    else if (accuracy >= (mean - stdDev)) question.difficulty = 'MEDIUM';
    else question.difficulty = 'HARD';
  });
};

/**
 * Generate human-readable insights from the analysis
 */
const generateInsights = (avgAccuracy, stdDev, distribution, attemptCount) => {
  const insights = [];

  // Overall performance insight
  if (avgAccuracy >= 75) {
    insights.push("✅ Students performed well overall. Consider increasing difficulty for future quizzes.");
  } else if (avgAccuracy >= 50) {
    insights.push("📊 Quiz difficulty is balanced. Most students achieved moderate scores.");
  } else {
    insights.push("⚠️ Quiz was challenging. Consider reviewing difficult topics with students.");
  }

  // Consistency insight
  if (stdDev < 10) {
    insights.push("📈 Very consistent performance across students.");
  } else if (stdDev > 25) {
    insights.push("📉 High variance in scores. Some students may need additional support.");
  }

  // Question distribution insight
  const totalQuestions = distribution.easy + distribution.medium + distribution.hard;
  if (distribution.hard > totalQuestions * 0.5) {
    insights.push(`🔴 ${distribution.hard}/${totalQuestions} questions are hard. Consider balancing difficulty.`);
  }
  if (distribution.easy > totalQuestions * 0.7) {
    insights.push(`🟢 Most questions are easy. Consider adding more challenging questions.`);
  }

  // Sample size insight
  if (attemptCount < 10) {
    insights.push(`📌 Only ${attemptCount} attempts analyzed. More data will improve accuracy.`);
  }

  return insights;
};

/**
 * Get difficulty analysis for a specific quiz
 */
export const getQuizDifficultyAnalysis = async (req, res) => {
  const { subjectId, quizId } = req.params;

  try {
    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: "Subject not found" });
    }

    let quiz;
    if (quizId) {
      quiz = subject.quizzes.id(quizId);
    } else {
      // Get the quizName from query
      const quizName = req.query.quizName || "Quiz 1";
      quiz = subject.quizzes.find(q => q.quizName.toLowerCase() === quizName.toLowerCase());
    }

    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    const analysis = calculateQuizDifficulty(quiz);

    res.json({
      success: true,
      subject: subject.name,
      quiz: quiz.quizName,
      quizId: quiz._id,
      analytics: quiz.analytics,
      difficultyAnalysis: analysis
    });

  } catch (error) {
    console.error("Get difficulty analysis error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all quizzes for a subject with their stats
 */
export const getSubjectQuizzes = async (req, res) => {
  const { subjectId } = req.params;

  try {
    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: "Subject not found" });
    }

    const quizzes = subject.quizzes.map(quiz => {
      const evaluatedAttempts = quiz.attempts.filter(a => a.status === 'EVALUATED');
      const avgScore = evaluatedAttempts.length > 0
        ? evaluatedAttempts.reduce((sum, a) => sum + a.percentage, 0) / evaluatedAttempts.length
        : 0;

      return {
        _id: quiz._id,
        quizName: quiz.quizName,
        quizNumber: quiz.quizNumber,
        totalQuestions: quiz.questions.length,
        totalMarks: quiz.questions.reduce((sum, q) => sum + (q.marks || 1), 0),
        totalAttempts: quiz.attempts.length,
        evaluatedAttempts: evaluatedAttempts.length,
        pendingAttempts: quiz.attempts.length - evaluatedAttempts.length,
        averageScore: Math.round(avgScore * 100) / 100,
        hasAnswerKey: quiz.questions.length > 0,
        isActive: quiz.isActive,
        createdAt: quiz.createdAt
      };
    });

    res.json({
      success: true,
      subject: subject.name,
      totalQuizzes: quizzes.length,
      quizzes
    });

  } catch (error) {
    console.error("Get quizzes error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get results for a specific quiz
 */
export const getQuizResults = async (req, res) => {
  const { subjectId, quizId } = req.params;

  try {
    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, error: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, error: "Quiz not found" });
    }

    const results = quiz.attempts
      .map(a => ({
        _id: a._id,
        enrollmentNumber: maskEnrollment(a.enrollmentNumber),
        totalMarks: a.totalMarks,
        obtainedMarks: a.obtainedMarks,
        percentage: a.percentage,
        grade: a.grade,
        status: a.status,
        submittedAt: a.submittedAt,
        evaluatedAt: a.evaluatedAt,
        answers: a.answers
      }))
      .sort((a, b) => b.percentage - a.percentage);

    const difficultyAnalysis = calculateQuizDifficulty(quiz);

    res.json({
      success: true,
      subject: subject.name,
      quiz: quiz.quizName,
      totalQuestions: quiz.questions.length,
      totalMarks: quiz.questions.reduce((sum, q) => sum + (q.marks || 1), 0),
      analytics: quiz.analytics,
      difficultyAnalysis,
      results
    });

  } catch (error) {
    console.error("Get quiz results error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create a new subject in SubjectQuiz model
 */
export const createSubjectQuiz = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: "Subject name is required"
      });
    }

    const existing = await SubjectQuiz.findOne({ name: name.toUpperCase() });
    if (existing) {
      return res.status(400).json({
        success: false,
        error: "Subject already exists",
        data: { _id: existing._id, name: existing.name }
      });
    }

    const subject = new SubjectQuiz({
      name: name.toUpperCase(),
      code: code?.toUpperCase() || '',
      description: description || '',
      quizzes: [],
      questionBank: []
    });

    await subject.save();

    res.status(201).json({
      success: true,
      message: "Subject created successfully",
      data: {
        _id: subject._id,
        name: subject.name,
        code: subject.code
      }
    });

  } catch (error) {
    console.error("Create subject error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get all subjects with quiz stats
 */
export const getAllSubjectsWithQuizzes = async (req, res) => {
  try {
    const subjects = await SubjectQuiz.find({ isActive: true })
      .select('name code description stats quizzes')
      .sort({ name: 1 });

    const result = subjects.map(s => ({
      _id: s._id,
      name: s.name,
      code: s.code,
      description: s.description,
      stats: s.stats,
      quizCount: s.quizzes.length,
      quizzes: s.quizzes.map(q => ({
        _id: q._id,
        quizName: q.quizName,
        totalQuestions: q.questions.length,
        totalAttempts: q.attempts.length,
        hasAnswerKey: q.questions.length > 0
      }))
    }));

    res.json({
      success: true,
      count: result.length,
      subjects: result
    });

  } catch (error) {
    console.error("Get subjects error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
