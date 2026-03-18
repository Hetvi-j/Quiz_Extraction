import mongoose from "mongoose";

const QuestionStatSchema = new mongoose.Schema({
  questionNumber: Number,
  questionText: String,
  questionType: String,  // MCQ, SHORT, LONG, TRUE_FALSE
  correctAnswer: String,
  studentAnswer: String,
  marks: Number,
  obtained: Number,
  isCorrect: Boolean,
  isFullMarks: Boolean,
  isPartial: Boolean,
  feedback: String,  // For subjective evaluation feedback
  correctPoints: [String],  // Points student got right
  missingPoints: [String]   // Points student missed
});

const SummarySchema = new mongoose.Schema({
  totalQuestions: Number,
  fullCorrect: Number,
  partialCorrect: Number,
  wrong: Number,
  attempted: Number
});

const ResultSchema = new mongoose.Schema({
  paper: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Paper',
    required: true
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject'
  },
  enrollmentNumber: { type: String, required: true },
  totalMarks: Number,
  obtainedMarks: Number,
  percentage: Number,
  grade: { type: String, default: 'F' },
  summary: SummarySchema,
  evaluatedAt: { type: Date, default: Date.now },
  questionStats: [QuestionStatSchema],
});

// Compound index to ensure one result per student per paper
ResultSchema.index({ paper: 1, enrollmentNumber: 1 }, { unique: true });

export default mongoose.model("Result", ResultSchema);
