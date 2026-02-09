import {
  SubjectList,
  getQuizCollection,
  createSubject,
  getSubjects,
  deleteSubject
} from "../models/SubjectDB.js";

// ==================== SUBJECTS ====================

export const getAllSubjects = async (req, res) => {
  try {
    const subjects = await getSubjects();
    res.json({ success: true, subjects });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createNewSubject = async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: "Subject name required" });
    }

    const subject = await createSubject(name, code, description);
    res.status(201).json({ success: true, subject });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteSubjectById = async (req, res) => {
  try {
    const name = await deleteSubject(req.params.subjectId);
    res.json({ success: true, message: `Subject "${name}" and all its quizzes deleted` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== QUIZZES ====================

export const getQuizzes = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quizzes = await Quiz.find().select('-attempts').sort({ quizNumber: 1 });

    res.json({ success: true, subjectName: subject.name, quizzes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createQuiz = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const count = await Quiz.countDocuments();

    const quiz = new Quiz({
      quizName: req.body.quizName || `Quiz ${count + 1}`,
      quizNumber: count + 1
    });

    await quiz.save();
    res.status(201).json({ success: true, quiz });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getQuizById = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    res.json({ success: true, subjectName: subject.name, quiz });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteQuiz = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quiz = await Quiz.findByIdAndDelete(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    res.json({ success: true, message: `Quiz "${quiz.quizName}" deleted` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== ANSWER KEY ====================

export const uploadAnswerKey = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    // Import your PDF extractor
    const { extractQuestionsFromPDF } = await import("../utils/pdfExtractor.js");
    const questions = await extractQuestionsFromPDF(req.file.path);

    quiz.questions = questions.map((q, i) => ({
      questionNumber: i + 1,
      questionText: q.questionText || q.question,
      options: q.options || [],
      correctAnswer: q.answer || q.correctAnswer,
      marks: q.marks || 1
    }));

    await quiz.save();

    res.json({
      success: true,
      message: "Answer key uploaded",
      totalQuestions: quiz.totalQuestions,
      totalMarks: quiz.totalMarks
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== STUDENT RESPONSES ====================

export const uploadResponses = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const { extractQuestionsFromPDF } = await import("../utils/pdfExtractor.js");
    let processed = 0;

    for (const file of req.files) {
      const enrollment = file.originalname.match(/(\d{10,})/)?.[1] || file.originalname.split('.')[0];

      // Skip if already exists
      if (quiz.attempts.find(a => a.enrollmentNumber === enrollment)) continue;

      const answers = await extractQuestionsFromPDF(file.path);

      quiz.attempts.push({
        enrollmentNumber: enrollment,
        answers: answers.map((a, i) => ({
          questionNumber: i + 1,
          studentAnswer: a.answer || a.correctAnswer || ''
        })),
        status: 'PENDING'
      });
      processed++;
    }

    await quiz.save();
    res.json({ success: true, message: `${processed} responses uploaded`, totalAttempts: quiz.totalAttempts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== EVALUATE ====================

export const evaluateQuiz = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    if (quiz.questions.length === 0) {
      return res.status(400).json({ success: false, message: "No answer key" });
    }

    // Evaluate pending attempts
    quiz.attempts.filter(a => a.status === 'PENDING').forEach(attempt => {
      let obtained = 0;

      attempt.answers.forEach(ans => {
        const q = quiz.questions.find(q => q.questionNumber === ans.questionNumber);
        if (q) {
          ans.isCorrect = ans.studentAnswer?.toLowerCase().trim() === q.correctAnswer?.toLowerCase().trim();
          ans.marksObtained = ans.isCorrect ? q.marks : 0;
          obtained += ans.marksObtained;
        }
      });

      attempt.obtainedMarks = obtained;
      attempt.percentage = Math.round((obtained / quiz.totalMarks) * 100);
      attempt.grade = attempt.percentage >= 90 ? 'A+' : attempt.percentage >= 80 ? 'A' :
                      attempt.percentage >= 70 ? 'B+' : attempt.percentage >= 60 ? 'B' :
                      attempt.percentage >= 50 ? 'C' : attempt.percentage >= 40 ? 'D' : 'F';
      attempt.status = 'EVALUATED';
      attempt.evaluatedAt = new Date();
    });

    // Update analytics
    const evaluated = quiz.attempts.filter(a => a.status === 'EVALUATED');
    if (evaluated.length > 0) {
      const pcts = evaluated.map(a => a.percentage);
      quiz.analytics = {
        averageScore: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
        highestScore: Math.max(...pcts),
        lowestScore: Math.min(...pcts),
        passRate: Math.round((evaluated.filter(a => a.percentage >= 40).length / evaluated.length) * 100)
      };
    }

    await quiz.save();

    res.json({
      success: true,
      message: `Evaluated ${evaluated.length} students`,
      quizName: quiz.quizName,
      subjectName: subject.name,
      analytics: quiz.analytics,
      results: evaluated.map(a => ({
        enrollmentNumber: a.enrollmentNumber,
        obtainedMarks: a.obtainedMarks,
        percentage: a.percentage,
        grade: a.grade
      })).sort((a, b) => b.percentage - a.percentage)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==================== RESULTS ====================

export const getResults = async (req, res) => {
  try {
    const subject = await SubjectList.findById(req.params.subjectId);
    if (!subject) {
      return res.status(404).json({ success: false, message: "Subject not found" });
    }

    const Quiz = getQuizCollection(subject.name);
    const quiz = await Quiz.findById(req.params.quizId);

    if (!quiz) {
      return res.status(404).json({ success: false, message: "Quiz not found" });
    }

    const results = quiz.attempts
      .filter(a => a.status === 'EVALUATED')
      .map(a => ({
        enrollmentNumber: a.enrollmentNumber,
        answers: a.answers,
        obtainedMarks: a.obtainedMarks,
        totalMarks: quiz.totalMarks,
        percentage: a.percentage,
        grade: a.grade
      }))
      .sort((a, b) => b.percentage - a.percentage);

    res.json({
      success: true,
      quizName: quiz.quizName,
      subjectName: subject.name,
      analytics: quiz.analytics,
      results
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
