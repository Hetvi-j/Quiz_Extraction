// // // models/Quiz.js
// // import mongoose from "mongoose";

// // const questionSchema = new mongoose.Schema({
// //   question_id: { type: String },
// //   marks: { type: String },
// //   question_text: { type: String, required: true },
// //   question_type: { type: String },
// //   options: [{ type: String }],
// //   answer: { type: String },
// // });

// // const quizSchema = new mongoose.Schema(
// //   {
// //     file_name: { type: String },
// //     questions: [questionSchema],
// //   },
// //   { timestamps: true }
// // );

// // export default mongoose.model("Quiz", quizSchema);


// // models/Quiz.js



// import mongoose from "mongoose";

// const documentInfoSchema = new mongoose.Schema({
//   enrollmentNumber: { type: Number, default: 0 }, // 👈 Default value here
//   date: { type: String },
//   totalMarks: { type: String },
// });

// const questionSchema = new mongoose.Schema({
//   questionText: { type: String, required: true },
//   questionType: { type: String },
//   marks: { type: Number, default: 0 },
//   options: [{ type: String }],
//   Answer: { type: String },
// });

// const quizSchema = new mongoose.Schema(
//   {
//     file_name: { type: String },
//     documentInfo: documentInfoSchema, // 👈 Not an array, single object
//     questions: [questionSchema],
//   },
//   { timestamps: true }
// );

// export default mongoose.model("Quiz", quizSchema);
