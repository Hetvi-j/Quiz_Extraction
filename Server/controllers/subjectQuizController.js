import SubjectQuiz from "../models/SubjectQuiz.js";
import { extractQuestionsFromPDF } from "../utils/pdfExtractor.js";
import fs from "fs";
import path from "path";

// ==================== SUBJECT OPERATIONS ====================

// Get all subjects (with summary only, not full quizzes)
export const getAllSubjects = async (req, res) => {
  try {
    const subjects = await SubjectQuiz.find({ isActive: true })
      .select('name code description stats quizzes.quizName quizzes._id quizzes.totalQuestions quizzes.totalMarks quizzes.totalAttempts quizzes.isActive')
      .sort({ name: 1 });

    // Transform to include quiz count
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
        totalQuestions: q.totalQuestions,
        totalMarks: q.totalMarks,
        totalAttempts: q.totalAttempts,
        isActive: q.isActive
      }))
    }));

    res.json({ success: true, subjects: result });
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single subject with all details
export const getSubjectById = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await SubjectQuiz.findById(subjectId);

    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    res.json({ success: true, subject });
  } catch (error) {
    console.error("Error fetching subject:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new subject
export const createSubject = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Subject name is required" });
    }

    const existing = await SubjectQuiz.findOne({ name: name.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: "Subject already exists" });
    }

    const subject = new SubjectQuiz({
      name: name.toUpperCase(),
      code: code?.toUpperCase() || '',
      description: description || '',
      createdBy: req.user?._id
    });

    await subject.save();

    res.status(201).json({
      success: true,
      message: "Subject created successfully",
      subject: {
        _id: subject._id,
        name: subject.name,
        code: subject.code,
        description: subject.description,
        stats: subject.stats
      }
    });
  } catch (error) {
    console.error("Error creating subject:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update subject
export const updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { name, code, description } = req.body;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    if (name) subject.name = name.toUpperCase();
    if (code !== undefined) subject.code = code.toUpperCase();
    if (description !== undefined) subject.description = description;

    await subject.save();

    res.json({ success: true, message: "Subject updated", subject });
  } catch (error) {
    console.error("Error updating subject:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete subject
export const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await SubjectQuiz.findByIdAndDelete(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    res.json({ success: true, message: `Subject "${subject.name}" deleted` });
  } catch (error) {
    console.error("Error deleting subject:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== QUIZ OPERATIONS ====================

// Get all quizzes for a subject
export const getSubjectQuizzes = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await SubjectQuiz.findById(subjectId)
      .select('name code quizzes');

    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quizzes = subject.quizzes.map(q => ({
      _id: q._id,
      quizName: q.quizName,
      quizNumber: q.quizNumber,
      description: q.description,
      totalQuestions: q.totalQuestions,
      totalMarks: q.totalMarks,
      totalAttempts: q.totalAttempts,
      duration: q.duration,
      isActive: q.isActive,
      analytics: q.analytics,
      hasAnswerKey: q.questions.length > 0,
      createdAt: q.createdAt
    }));

    res.json({
      success: true,
      subjectName: subject.name,
      subjectCode: subject.code,
      quizzes
    });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get single quiz details
export const getQuizById = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    res.json({
      success: true,
      subjectName: subject.name,
      quiz
    });
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new quiz in subject
export const createQuiz = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { quizName, description, duration, passingPercentage } = req.body;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quizNumber = subject.quizzes.length + 1;
    const newQuiz = {
      quizName: quizName || `Quiz ${quizNumber}`,
      quizNumber,
      description: description || '',
      duration: duration || 30,
      passingPercentage: passingPercentage || 40
    };

    subject.quizzes.push(newQuiz);
    await subject.save();

    const createdQuiz = subject.quizzes[subject.quizzes.length - 1];

    res.status(201).json({
      success: true,
      message: "Quiz created successfully",
      quiz: {
        _id: createdQuiz._id,
        quizName: createdQuiz.quizName,
        quizNumber: createdQuiz.quizNumber,
        totalQuestions: 0,
        totalMarks: 0
      }
    });
  } catch (error) {
    console.error("Error creating quiz:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update quiz
export const updateQuiz = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;
    const updates = req.body;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    // Update allowed fields
    if (updates.quizName) quiz.quizName = updates.quizName;
    if (updates.description !== undefined) quiz.description = updates.description;
    if (updates.duration) quiz.duration = updates.duration;
    if (updates.passingPercentage) quiz.passingPercentage = updates.passingPercentage;
    if (updates.isActive !== undefined) quiz.isActive = updates.isActive;

    await subject.save();

    res.json({ success: true, message: "Quiz updated", quiz });
  } catch (error) {
    console.error("Error updating quiz:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete quiz
export const deleteQuiz = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const quizName = quiz.quizName;
    subject.quizzes.pull(quizId);
    await subject.save();

    res.json({ success: true, message: `Quiz "${quizName}" deleted` });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== ANSWER KEY OPERATIONS ====================

// Upload answer key (questions) for a quiz
export const uploadAnswerKey = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    // Extract questions from PDF
    const filePath = req.file.path;
    const questions = await extractQuestionsFromPDF(filePath);

    if (!questions || questions.length === 0) {
      return res.status(400).json({ success: false, message: "Could not extract questions from file" });
    }

    // Format questions
    const formattedQuestions = questions.map((q, idx) => ({
      questionNumber: idx + 1,
      questionText: q.questionText || q.question || `Question ${idx + 1}`,
      questionType: q.type || 'MCQ',
      options: q.options || [],
      correctAnswer: q.answer || q.correctAnswer || '',
      marks: q.marks || 1,
      difficulty: q.difficulty || 'MEDIUM'
    }));

    quiz.questions = formattedQuestions;
    quiz.answerKeyFile = req.file.filename;

    // Add to question bank
    formattedQuestions.forEach(q => {
      const existing = subject.questionBank.find(
        qb => qb.questionText.toLowerCase() === q.questionText.toLowerCase()
      );
      if (existing) {
        existing.frequency += 1;
      } else {
        subject.questionBank.push({
          questionText: q.questionText,
          correctAnswer: q.correctAnswer,
          marks: q.marks,
          difficulty: q.difficulty,
          frequency: 1
        });
      }
    });

    await subject.save();

    res.json({
      success: true,
      message: "Answer key uploaded successfully",
      totalQuestions: quiz.totalQuestions,
      totalMarks: quiz.totalMarks
    });
  } catch (error) {
    console.error("Error uploading answer key:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add questions manually
export const addQuestions = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;
    const { questions } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: "Questions array required" });
    }

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const startNum = quiz.questions.length + 1;
    const formattedQuestions = questions.map((q, idx) => ({
      questionNumber: startNum + idx,
      questionText: q.questionText,
      questionType: q.questionType || 'MCQ',
      options: q.options || [],
      correctAnswer: q.correctAnswer,
      marks: q.marks || 1,
      difficulty: q.difficulty || 'MEDIUM'
    }));

    quiz.questions.push(...formattedQuestions);
    await subject.save();

    res.json({
      success: true,
      message: `Added ${formattedQuestions.length} questions`,
      totalQuestions: quiz.totalQuestions
    });
  } catch (error) {
    console.error("Error adding questions:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== STUDENT ATTEMPT OPERATIONS ====================

// Upload student responses (bulk)
export const uploadStudentResponses = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    let processed = 0;
    let skipped = 0;

    for (const file of req.files) {
      try {
        // Extract enrollment from filename
        const enrollmentMatch = file.originalname.match(/(\d{10,})/);
        const enrollmentNumber = enrollmentMatch ? enrollmentMatch[1] : file.originalname.split('.')[0];

        // Check if already attempted
        const existingAttempt = quiz.attempts.find(a => a.enrollmentNumber === enrollmentNumber);
        if (existingAttempt) {
          skipped++;
          continue;
        }

        // Extract answers from PDF
        const answers = await extractQuestionsFromPDF(file.path);

        const studentAnswers = (answers || []).map((a, idx) => ({
          questionNumber: idx + 1,
          studentAnswer: a.answer || a.correctAnswer || '',
          isCorrect: false,
          marksObtained: 0
        }));

        quiz.attempts.push({
          enrollmentNumber,
          answers: studentAnswers,
          status: 'PENDING',
          submittedAt: new Date()
        });

        processed++;
      } catch (err) {
        console.error(`Error processing ${file.originalname}:`, err);
        skipped++;
      }
    }

    await subject.save();

    res.json({
      success: true,
      message: `Processed ${processed} responses, skipped ${skipped}`,
      totalAttempts: quiz.totalAttempts
    });
  } catch (error) {
    console.error("Error uploading responses:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Evaluate all pending attempts
export const evaluateQuiz = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    if (quiz.questions.length === 0) {
      return res.status(400).json({ success: false, message: "No answer key uploaded" });
    }

    const pendingAttempts = quiz.attempts.filter(a => a.status === 'PENDING');
    if (pendingAttempts.length === 0) {
      return res.status(400).json({ success: false, message: "No pending attempts to evaluate" });
    }

    // Evaluate each attempt
    pendingAttempts.forEach(attempt => {
      let totalObtained = 0;

      attempt.answers.forEach(ans => {
        const question = quiz.questions.find(q => q.questionNumber === ans.questionNumber);
        if (question) {
          const isCorrect = ans.studentAnswer?.toLowerCase().trim() === question.correctAnswer?.toLowerCase().trim();
          ans.isCorrect = isCorrect;
          ans.marksObtained = isCorrect ? question.marks : 0;
          totalObtained += ans.marksObtained;
        }
      });

      attempt.totalMarks = quiz.totalMarks;
      attempt.obtainedMarks = totalObtained;
      attempt.percentage = Math.round((totalObtained / quiz.totalMarks) * 100);
      attempt.grade = getGrade(attempt.percentage);
      attempt.status = 'EVALUATED';
      attempt.evaluatedAt = new Date();
    });

    await subject.save();

    // Return results
    const results = quiz.attempts
      .filter(a => a.status === 'EVALUATED')
      .map(a => ({
        enrollmentNumber: a.enrollmentNumber,
        totalMarks: a.totalMarks,
        obtainedMarks: a.obtainedMarks,
        percentage: a.percentage,
        grade: a.grade
      }))
      .sort((a, b) => b.percentage - a.percentage);

    res.json({
      success: true,
      message: `Evaluated ${pendingAttempts.length} attempts`,
      quizName: quiz.quizName,
      subjectName: subject.name,
      analytics: quiz.analytics,
      results
    });
  } catch (error) {
    console.error("Error evaluating quiz:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get quiz results
export const getQuizResults = async (req, res) => {
  try {
    const { subjectId, quizId } = req.params;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const quiz = subject.quizzes.id(quizId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const results = quiz.attempts
      .filter(a => a.status === 'EVALUATED')
      .map(a => ({
        _id: a._id,
        enrollmentNumber: a.enrollmentNumber,
        totalMarks: a.totalMarks,
        obtainedMarks: a.obtainedMarks,
        percentage: a.percentage,
        grade: a.grade,
        answers: a.answers,
        evaluatedAt: a.evaluatedAt
      }))
      .sort((a, b) => b.percentage - a.percentage);

    res.json({
      success: true,
      quizName: quiz.quizName,
      subjectName: subject.name,
      analytics: quiz.analytics,
      totalAttempts: quiz.totalAttempts,
      results
    });
  } catch (error) {
    console.error("Error fetching results:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== QUESTION BANK ====================

// Get subject's question bank
export const getQuestionBank = async (req, res) => {
  try {
    const { subjectId } = req.params;

    const subject = await SubjectQuiz.findById(subjectId)
      .select('name questionBank');

    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    res.json({
      success: true,
      subjectName: subject.name,
      totalQuestions: subject.questionBank.length,
      questions: subject.questionBank
    });
  } catch (error) {
    console.error("Error fetching question bank:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== STUDENT HISTORY ====================

// Get student's history in a subject
export const getStudentHistory = async (req, res) => {
  try {
    const { subjectId, enrollmentNumber } = req.params;

    const subject = await SubjectQuiz.findById(subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const history = [];
    subject.quizzes.forEach(quiz => {
      const attempt = quiz.attempts.find(a => a.enrollmentNumber === enrollmentNumber);
      if (attempt) {
        history.push({
          quizId: quiz._id,
          quizName: quiz.quizName,
          totalMarks: attempt.totalMarks,
          obtainedMarks: attempt.obtainedMarks,
          percentage: attempt.percentage,
          grade: attempt.grade,
          status: attempt.status,
          submittedAt: attempt.submittedAt,
          evaluatedAt: attempt.evaluatedAt
        });
      }
    });

    res.json({
      success: true,
      subjectName: subject.name,
      enrollmentNumber,
      totalQuizzes: history.length,
      history
    });
  } catch (error) {
    console.error("Error fetching student history:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== HELPERS ====================

function getGrade(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}
