import mongoose from "mongoose";

const responseSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  selected: { type: String, required: true }, // e.g., "A" or "int* x, y;"
});

const studentResponseSchema = new mongoose.Schema(
  {
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
    studentId: { type: String, required: true },
    answers: [responseSchema],
  },
  { timestamps: true }
);

export default mongoose.model("StudentResponse", studentResponseSchema);
