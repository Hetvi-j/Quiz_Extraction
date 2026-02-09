import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  questionType: { type: String },
  marks: { type: Number, default: 0 },
  options: [{ type: String }],
  answer: { type: String }
});

const studentResponseSchema = new mongoose.Schema({
  enrollmentNumber: { type: String, required: true },
  fileName: { type: String },
  questions: [questionSchema],
  submittedAt: { type: Date, default: Date.now }
});

const paperSchema = new mongoose.Schema({
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  paperName: {
    type: String,
    required: true,
    trim: true
  },
  paperNumber: {
    type: Number,
    default: 1
  },
  totalMarks: {
    type: Number,
    default: 0
  },
  key: {
    fileName: { type: String },
    questions: [questionSchema],
    uploadedAt: { type: Date }
  },
  studentResponses: [studentResponseSchema],
  totalStudents: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Update totalStudents before saving
paperSchema.pre('save', function(next) {
  this.totalStudents = this.studentResponses.length;
  next();
});

// Compound index for unique paper names within a subject
paperSchema.index({ subject: 1, paperName: 1 }, { unique: true });

export default mongoose.model("Paper", paperSchema);
