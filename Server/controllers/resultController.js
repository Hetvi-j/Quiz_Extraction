import Quiz1 from "../models/quiz_new.js";
import Result from "../models/Result.js";
import {
  gradeMcqAnswer,
  fastGradeShortText,
  roundToHalf
} from "../utils/evaluationHelpers.js";

const maskEnrollment = (enrollment) => {
  if (!enrollment) return enrollment;
  const str = enrollment.toString();
  if (str.length <= 5) return "*".repeat(str.length);
  return str.slice(0, -5) + "*****";
};

const gradeAnswer = (correctAnswer, studentAnswer, marks) => {
  const mcq = gradeMcqAnswer(correctAnswer, studentAnswer, marks);
  if (mcq.normalizedStudentAnswer || !studentAnswer) {
    return {
      obtained: roundToHalf(mcq.obtained),
      feedback: mcq.feedback,
      normalizedStudentAnswer: mcq.normalizedStudentAnswer || studentAnswer
    };
  }

  const text = fastGradeShortText(correctAnswer, studentAnswer, marks);
  return {
    obtained: roundToHalf(text.resolved ? text.obtained : 0),
    feedback: text.feedback,
    normalizedStudentAnswer: studentAnswer
  };
};

const buildQuestionStats = (answerKey) =>
  answerKey.questions.map((question, index) => ({
    questionNumber: index + 1,
    questionText: question.questionText?.trim() || "",
    correctAnswer: (question.Answer || question.answer || "").trim(),
    studentAnswer: "",
    marks: Number(question.marks) || 0,
    isCorrect: false,
    isFullMarks: false,
    isPartial: false,
    obtained: 0,
    feedback: ""
  }));

const applyComparison = (questionStats, studentQuiz) => {
  let obtainedMarks = 0;

  for (let i = 0; i < studentQuiz.questions.length; i++) {
    const studentQ = studentQuiz.questions[i];
    const correctQ = questionStats[i];
    if (!correctQ) continue;

    const studentAnswer = (studentQ.Answer || studentQ.answer || "").trim();
    const result = gradeAnswer(correctQ.correctAnswer, studentAnswer, correctQ.marks);

    correctQ.studentAnswer = result.normalizedStudentAnswer;
    correctQ.feedback = result.feedback;
    correctQ.obtained = result.obtained;
    correctQ.isCorrect = result.obtained > 0;
    correctQ.isFullMarks = result.obtained === correctQ.marks;
    correctQ.isPartial = result.obtained > 0 && result.obtained < correctQ.marks;

    obtainedMarks += result.obtained;
  }

  return obtainedMarks;
};

export const compareAnswers = async (req, res) => {
  try {
    const answerKey = await Quiz1.findOne({ "documentInfo.enrollmentNumber": 0 });
    if (!answerKey) {
      return res.status(404).json({ message: "Answer key not found (enrollment 0)" });
    }

    const { enrollmentNumber } = req.body;
    if (!enrollmentNumber) {
      return res.status(400).json({ message: "Enrollment number required" });
    }

    const studentQuiz = await Quiz1.findOne({
      "documentInfo.enrollmentNumber": enrollmentNumber
    });
    if (!studentQuiz) {
      return res.status(404).json({ message: `No submission found for enrollment ${enrollmentNumber}` });
    }

    const questionStats = buildQuestionStats(answerKey);
    const totalMarks = questionStats.reduce((sum, question) => sum + question.marks, 0);
    const obtainedMarks = applyComparison(questionStats, studentQuiz);
    const percentage = totalMarks > 0 ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : 0;

    const resultDoc = new Result({
      enrollmentNumber,
      totalMarks,
      obtainedMarks,
      percentage,
      evaluatedAt: new Date(),
      questionStats
    });

    await resultDoc.save();

    return res.status(200).json({
      message: "Answers compared and result saved successfully",
      totalMarks,
      obtainedMarks,
      percentage,
      questionStats
    });
  } catch (error) {
    console.error("Error comparing answers:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const compareAllAnswers = async (req, res) => {
  try {
    const answerKey = await Quiz1.findOne({ "documentInfo.enrollmentNumber": 0 });
    if (!answerKey) {
      return res.status(404).json({ message: "Answer key not found" });
    }

    const students = await Quiz1.find({ "documentInfo.enrollmentNumber": { $ne: 0 } });
    if (!students.length) {
      return res.status(404).json({ message: "No students found" });
    }

    const allResults = [];

    for (const studentQuiz of students) {
      const questionStats = buildQuestionStats(answerKey);
      const totalMarks = questionStats.reduce((sum, question) => sum + question.marks, 0);
      const obtainedMarks = applyComparison(questionStats, studentQuiz);
      const percentage = totalMarks > 0 ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : 0;

      const result = await Result.findOneAndUpdate(
        { enrollmentNumber: studentQuiz.documentInfo.enrollmentNumber },
        {
          enrollmentNumber: studentQuiz.documentInfo.enrollmentNumber,
          totalMarks,
          obtainedMarks,
          percentage,
          questionStats,
          evaluatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      allResults.push(result);
    }

    const maskedResults = allResults
      .map((result) => result.toObject())
      .sort((a, b) => (b.obtainedMarks || 0) - (a.obtainedMarks || 0))
      .map((result) => ({
        ...result,
        enrollmentNumber: maskEnrollment(result.enrollmentNumber)
      }));

    return res.status(200).json({
      message: "All students evaluated successfully",
      results: maskedResults
    });
  } catch (error) {
    console.error("Error comparing all answers:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};
