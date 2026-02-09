import mongoose from "mongoose";

const questionItemSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  questionType: { type: String },
  marks: { type: Number, default: 0 },
  options: [{ type: String }],
  answer: { type: String },
  frequency: { type: Number, default: 1 },
  sourceFiles: [{ type: String }],
  sourcePapers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Paper'
  }],
  addedAt: { type: Date, default: Date.now },
  // Difficulty analysis fields
  difficulty: {
    type: String,
    enum: ['Easy', 'Medium', 'Hard', 'Not Analyzed'],
    default: 'Not Analyzed'
  },
  difficultyStats: {
    totalAttempts: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    partialCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    lastAnalyzedAt: { type: Date }
  }
});

const questionBankSchema = new mongoose.Schema(
  {
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
      unique: true
    },
    subjectName: {
      type: String,
      required: true,
      uppercase: true
    },
    questions: [questionItemSchema],
    totalQuestions: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Update totalQuestions before saving
questionBankSchema.pre('save', function(next) {
  this.totalQuestions = this.questions.length;
  next();
});

export default mongoose.model("QuestionBank", questionBankSchema);
