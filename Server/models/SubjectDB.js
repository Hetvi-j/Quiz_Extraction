import mongoose from "mongoose";

// ==================== QUIZ SCHEMA ====================
const QuizSchema = new mongoose.Schema({
  quizName: { type: String, required: true },
  quizNumber: Number,

  // Questions (Answer Key)
  questions: [{
    questionNumber: Number,
    questionText: String,
    options: [String],
    correctAnswer: String,
    marks: { type: Number, default: 1 }
  }],
  totalQuestions: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },

  // Student Attempts
  attempts: [{
    enrollmentNumber: String,
    answers: [{
      questionNumber: Number,
      studentAnswer: String,
      isCorrect: Boolean,
      marksObtained: Number
    }],
    obtainedMarks: Number,
    percentage: Number,
    grade: String,
    status: { type: String, default: 'PENDING' },
    evaluatedAt: Date
  }],
  totalAttempts: { type: Number, default: 0 },

  // Analytics
  analytics: {
    averageScore: { type: Number, default: 0 },
    highestScore: { type: Number, default: 0 },
    lowestScore: { type: Number, default: 0 },
    passRate: { type: Number, default: 0 }
  }
}, { timestamps: true });

// Auto-calculate before save
QuizSchema.pre('save', function(next) {
  this.totalQuestions = this.questions.length;
  this.totalMarks = this.questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  this.totalAttempts = this.attempts.length;
  next();
});

// ==================== SUBJECT MASTER LIST ====================
const SubjectListSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, uppercase: true },
  code: { type: String, uppercase: true },
  description: String,
  quizCollection: String, // "dsa_quizzes", "physics_quizzes"
  quizCount: { type: Number, default: 0 }
}, { timestamps: true });

export const SubjectList = mongoose.model("SubjectList", SubjectListSchema);

// ==================== DYNAMIC MODEL GETTER ====================
const models = {};

export function getQuizCollection(subjectName) {
  const name = subjectName.toLowerCase().replace(/\s+/g, '_') + '_quizzes';

  if (!models[name]) {
    models[name] = mongoose.model(name, QuizSchema, name);
  }
  return models[name];
}

// ==================== HELPER FUNCTIONS ====================

// Create new subject with its quiz collection
export async function createSubject(name, code = '', description = '') {
  const collectionName = name.toLowerCase().replace(/\s+/g, '_') + '_quizzes';

  const subject = new SubjectList({
    name: name.toUpperCase(),
    code,
    description,
    quizCollection: collectionName
  });

  await subject.save();
  getQuizCollection(name); // Initialize collection

  return subject;
}

// Get all subjects
export async function getSubjects() {
  const subjects = await SubjectList.find().sort({ name: 1 });

  // Update quiz counts
  for (let subject of subjects) {
    const Quiz = getQuizCollection(subject.name);
    subject.quizCount = await Quiz.countDocuments();
  }

  return subjects;
}

// Delete subject and its collection
export async function deleteSubject(subjectId) {
  const subject = await SubjectList.findById(subjectId);
  if (!subject) throw new Error('Subject not found');

  // Drop the quiz collection
  try {
    await mongoose.connection.db.dropCollection(subject.quizCollection);
  } catch (e) {}

  await SubjectList.findByIdAndDelete(subjectId);
  return subject.name;
}
