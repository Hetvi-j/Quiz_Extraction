// // models/QuestionAccuracy.js
// import mongoose from "mongoose";

// const QuestionAccuracySchema = new mongoose.Schema({
//   questionNumber: { type: Number, required: true },
//   questionText: { type: String, required: true },
//   totalAttempts: { type: Number, required: true },
//   correctCount: { type: Number, required: true },
//   wrongCount: { type: Number, required: true },
//   accuracy: { type: Number, required: true }, // percentage of correct answers
// });

// export default mongoose.model("QuestionAccuracy", QuestionAccuracySchema);


import mongoose from "mongoose";

const QuestionAccuracySchema = new mongoose.Schema({
  questionNumber: { type: Number, required: true },
  questionText: { type: String, required: true },
  totalAttempts: { type: Number, required: true },
  correctCount: { type: Number, required: true },
  wrongCount: { type: Number, required: true },
  accuracy: { type: Number, required: true },  // percentage
  difficultyLevel: { type: String, enum: ["Easy", "Medium", "Hard"], required: true } // 👈 NEW FIELD
});

export default mongoose.model("QuestionAccuracy", QuestionAccuracySchema);