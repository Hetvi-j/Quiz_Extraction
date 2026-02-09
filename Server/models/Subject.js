import mongoose from 'mongoose';

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
    duration: { type: Number, default: 30 },
    passingPercentage: { type: Number, default: 40 },
    isActive: { type: Boolean, default: true },

    // Analytics
    analytics: {
        averageScore: { type: Number, default: 0 },
        highestScore: { type: Number, default: 0 },
        lowestScore: { type: Number, default: 0 },
        passCount: { type: Number, default: 0 },
        failCount: { type: Number, default: 0 },
        passRate: { type: Number, default: 0 }
    },

    answerKeyFile: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Auto-update quiz counts before save
QuizSchema.pre('save', function(next) {
    this.totalQuestions = this.questions.length;
    this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 0), 0);
    this.totalAttempts = this.attempts.length;
    this.updatedAt = new Date();

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
const subjectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
        index: true
    },
    description: {
        type: String,
        trim: true,
        default: ''
    },
    code: {
        type: String,
        trim: true,
        uppercase: true,
        default: ''
    },
    totalPapers: {
        type: Number,
        default: 0
    },

    // All quizzes for this subject
    quizzes: [QuizSchema],

    // Question Bank (all unique questions)
    questionBank: [{
        questionText: { type: String, required: true },
        questionType: {
            type: String,
            enum: ['MCQ', 'SHORT', 'LONG', 'TRUE_FALSE'],
            default: 'MCQ'
        },
        options: [{ type: String }],
        correctAnswer: { type: String },
        marks: { type: Number, default: 1 },
        frequency: { type: Number, default: 1 },
        difficulty: {
            type: String,
            enum: ['EASY', 'MEDIUM', 'HARD'],
            default: 'MEDIUM'
        },
        tags: [{ type: String }],
        sourceFiles: [{ type: String }],
        sourcePapers: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Paper'
        }],
        addedAt: { type: Date, default: Date.now }
    }],

    // Subject-level stats
    stats: {
        totalQuizzes: { type: Number, default: 0 },
        totalQuestions: { type: Number, default: 0 },
        totalAttempts: { type: Number, default: 0 },
        averageScore: { type: Number, default: 0 }
    },

    // Question Bank Analytics
    questionBankStats: {
        totalQuestions: { type: Number, default: 0 },
        byDifficulty: {
            easy: { type: Number, default: 0 },
            medium: { type: Number, default: 0 },
            hard: { type: Number, default: 0 }
        },
        byType: {
            mcq: { type: Number, default: 0 },
            short: { type: Number, default: 0 },
            long: { type: Number, default: 0 },
            trueFalse: { type: Number, default: 0 }
        },
        mostFrequent: [{ type: String }],
        lastUpdated: { type: Date, default: Date.now }
    },

    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users'
    },
    isActive: { type: Boolean, default: true }

}, { timestamps: true });

// Auto-update stats before save
subjectSchema.pre('save', function(next) {
    // Update quiz stats
    this.stats.totalQuizzes = this.quizzes.length;
    this.stats.totalQuestions = this.quizzes.reduce((sum, q) => sum + q.totalQuestions, 0);
    this.stats.totalAttempts = this.quizzes.reduce((sum, q) => sum + q.totalAttempts, 0);

    const allAverages = this.quizzes
        .filter(q => q.analytics && q.analytics.averageScore > 0)
        .map(q => q.analytics.averageScore);

    if (allAverages.length > 0) {
        this.stats.averageScore = Math.round(allAverages.reduce((a, b) => a + b, 0) / allAverages.length);
    }

    // Update question bank stats
    this.questionBankStats.totalQuestions = this.questionBank.length;
    this.questionBankStats.byDifficulty.easy = this.questionBank.filter(q => q.difficulty === 'EASY').length;
    this.questionBankStats.byDifficulty.medium = this.questionBank.filter(q => q.difficulty === 'MEDIUM').length;
    this.questionBankStats.byDifficulty.hard = this.questionBank.filter(q => q.difficulty === 'HARD').length;

    this.questionBankStats.byType.mcq = this.questionBank.filter(q => q.questionType === 'MCQ').length;
    this.questionBankStats.byType.short = this.questionBank.filter(q => q.questionType === 'SHORT').length;
    this.questionBankStats.byType.long = this.questionBank.filter(q => q.questionType === 'LONG').length;
    this.questionBankStats.byType.trueFalse = this.questionBank.filter(q => q.questionType === 'TRUE_FALSE').length;

    // Get top 5 most frequent questions
    const sorted = [...this.questionBank].sort((a, b) => b.frequency - a.frequency);
    this.questionBankStats.mostFrequent = sorted.slice(0, 5).map(q => q.questionText);
    this.questionBankStats.lastUpdated = new Date();

    next();
});

// ==================== INDEXES ====================
subjectSchema.index({ 'quizzes.quizName': 1 });
subjectSchema.index({ 'quizzes.attempts.enrollmentNumber': 1 });
subjectSchema.index({ 'questionBank.questionText': 1 });

// ==================== METHODS ====================

// Get a specific quiz by ID or name
subjectSchema.methods.getQuiz = function(quizIdOrName) {
    return this.quizzes.find(q =>
        q._id.toString() === quizIdOrName ||
        q.quizName.toLowerCase() === quizIdOrName.toLowerCase()
    );
};

// Add a new quiz
subjectSchema.methods.addQuiz = function(quizData) {
    const quizNumber = this.quizzes.length + 1;
    this.quizzes.push({
        ...quizData,
        quizNumber,
        quizName: quizData.quizName || `Quiz ${quizNumber}`
    });
    return this.save();
};

// Add question to bank
subjectSchema.methods.addToQuestionBank = function(questionData) {
    const existing = this.questionBank.find(
        q => q.questionText.toLowerCase() === questionData.questionText.toLowerCase()
    );

    if (existing) {
        existing.frequency += 1;
        if (questionData.sourceFiles) {
            questionData.sourceFiles.forEach(file => {
                if (!existing.sourceFiles.includes(file)) {
                    existing.sourceFiles.push(file);
                }
            });
        }
    } else {
        this.questionBank.push(questionData);
    }
    return this.save();
};

// Get student's all attempts across quizzes
subjectSchema.methods.getStudentHistory = function(enrollmentNumber) {
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

export default mongoose.model('Subject', subjectSchema);
