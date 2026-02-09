import mongoose from "mongoose";

// ==================== QUESTION SCHEMA ====================
const QuestionSchema = new mongoose.Schema({
  questionNumber: { type: Number, required: true },
  questionText: { type: String, required: true },
  questionType: {
    type: String,
    enum: ['MCQ', 'SHORT', 'LONG', 'TRUE_FALSE'],
    default: 'MCQ'
  },
  options: [{ type: String }],
  correctAnswer: { type: String, required: true },
  marks: { type: Number, default: 1 },
  difficulty: {
    type: String,
    enum: ['EASY', 'MEDIUM', 'HARD'],
    default: 'MEDIUM'
  }
});

// ==================== STUDENT ATTEMPT SCHEMA ====================
const StudentAnswerSchema = new mongoose.Schema({
  questionNumber: Number,
  studentAnswer: String,
  isCorrect: Boolean,
  marksObtained: { type: Number, default: 0 },
  isPartial: { type: Boolean, default: false }
});

const StudentAttemptSchema = new mongoose.Schema({
  enrollmentNumber: { type: String, required: true },
  studentName: { type: String },
  answers: [StudentAnswerSchema],
  totalMarks: { type: Number, default: 0 },
  obtainedMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  grade: { type: String, default: 'F' },
  status: {
    type: String,
    enum: ['PENDING', 'EVALUATED', 'REVIEWED'],
    default: 'PENDING'
  },
  submittedAt: { type: Date, default: Date.now },
  evaluatedAt: { type: Date }
});

// ==================== QUIZ SCHEMA ====================
const QuizSchema = new mongoose.Schema({
  quizName: { type: String, required: true },
  quizNumber: { type: Number, default: 1 },
  description: { type: String, default: '' },

  // Answer Key
  questions: [QuestionSchema],
  totalQuestions: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },

  // Student Attempts
  attempts: [StudentAttemptSchema],
  totalAttempts: { type: Number, default: 0 },

  // Quiz Settings
  duration: { type: Number, default: 30 }, // in minutes
  passingPercentage: { type: Number, default: 40 },
  isActive: { type: Boolean, default: true },

  // Analytics (auto-calculated)
  analytics: {
    averageScore: { type: Number, default: 0 },
    highestScore: { type: Number, default: 0 },
    lowestScore: { type: Number, default: 0 },
    passCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    passRate: { type: Number, default: 0 }
  },

  // Files
  answerKeyFile: { type: String },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Auto-update counts before save
QuizSchema.pre('save', function(next) {
  this.totalQuestions = this.questions.length;
  this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
  this.totalAttempts = this.attempts.length;
  this.updatedAt = new Date();

  // Calculate analytics if there are attempts
  if (this.attempts.length > 0) {
    const evaluated = this.attempts.filter(a => a.status === 'EVALUATED');
    if (evaluated.length > 0) {
      const percentages = evaluated.map(a => a.percentage);
      this.analytics.averageScore = Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
      this.analytics.highestScore = Math.max(...percentages);
      this.analytics.lowestScore = Math.min(...percentages);
      this.analytics.passCount = evaluated.filter(a => a.percentage >= this.passingPercentage).length;
      this.analytics.failCount = evaluated.length - this.analytics.passCount;
      this.analytics.passRate = Math.round((this.analytics.passCount / evaluated.length) * 100);
    }
  }
  next();
});

// ==================== SUBJECT SCHEMA ====================
const SubjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
    index: true
  },
  code: {
    type: String,
    trim: true,
    uppercase: true,
    default: ''
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },

  // All quizzes for this subject
  quizzes: [QuizSchema],

  // Question Bank (all unique questions from all quizzes)
  questionBank: [{
    questionText: String,
    correctAnswer: String,
    marks: Number,
    frequency: { type: Number, default: 1 }, // how many times used
    difficulty: String,
    tags: [String]
  }],

  // Subject-level stats
  stats: {
    totalQuizzes: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    totalAttempts: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 }
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users'
  },
  isActive: { type: Boolean, default: true }

}, { timestamps: true });

// Auto-update stats before save
SubjectSchema.pre('save', function(next) {
  this.stats.totalQuizzes = this.quizzes.length;
  this.stats.totalQuestions = this.quizzes.reduce((sum, q) => sum + q.totalQuestions, 0);
  this.stats.totalAttempts = this.quizzes.reduce((sum, q) => sum + q.totalAttempts, 0);

  // Calculate overall average
  const allAverages = this.quizzes
    .filter(q => q.analytics.averageScore > 0)
    .map(q => q.analytics.averageScore);

  if (allAverages.length > 0) {
    this.stats.averageScore = Math.round(allAverages.reduce((a, b) => a + b, 0) / allAverages.length);
  }

  next();
});

// ==================== INDEXES ====================
SubjectSchema.index({ 'quizzes.quizName': 1 });
SubjectSchema.index({ 'quizzes.attempts.enrollmentNumber': 1 });

// ==================== METHODS ====================

// Get a specific quiz by ID or name
SubjectSchema.methods.getQuiz = function(quizIdOrName) {
  return this.quizzes.find(q =>
    q._id.toString() === quizIdOrName ||
    q.quizName.toLowerCase() === quizIdOrName.toLowerCase()
  );
};

// Add a new quiz
SubjectSchema.methods.addQuiz = function(quizData) {
  const quizNumber = this.quizzes.length + 1;
  this.quizzes.push({
    ...quizData,
    quizNumber,
    quizName: quizData.quizName || `Quiz ${quizNumber}`
  });
  return this.save();
};

// Get student's all attempts across quizzes
SubjectSchema.methods.getStudentHistory = function(enrollmentNumber) {
  const history = [];
  this.quizzes.forEach(quiz => {
    const attempt = quiz.attempts.find(a => a.enrollmentNumber === enrollmentNumber);
    if (attempt) {
      history.push({
        quizName: quiz.quizName,
        quizId: quiz._id,
        ...attempt.toObject()
      });
    }
  });
  return history;
};

export default mongoose.model("SubjectQuiz", SubjectSchema);
