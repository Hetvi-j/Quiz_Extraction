//import Quiz from "../models/quiz.model.js";
import Quiz1 from "../models/quiz_new.js";
import Result from "../models/Result.js";

// Helper function to mask enrollment number (hide last 5 digits)
const maskEnrollment = (enrollment) => {
  if (!enrollment) return enrollment;
  const str = enrollment.toString();
  if (str.length <= 5) return '*'.repeat(str.length);
  return str.slice(0, -5) + '*****';
};

export const compareAnswers = async (req, res) => {
  try {
    // STEP 1️⃣: Get the answer key (enrollment 0)
    const answerKey = await Quiz1.findOne({
      "documentInfo.enrollmentNumber": 0,
    });

    if (!answerKey) {
      return res.status(404).json({
        message: "❌ Answer key not found (enrollment 0)",
      });
    }

    // STEP 2️⃣: Get student submission
    const { enrollmentNumber } = req.body;
    if (!enrollmentNumber) {
      return res.status(400).json({ message: "Enrollment number required" });
    }

    const studentQuiz = await Quiz1.findOne({
      "documentInfo.enrollmentNumber": enrollmentNumber,
    });

    if (!studentQuiz) {
      return res.status(404).json({
        message: `❌ No submission found for enrollment ${enrollmentNumber}`,
      });
    }

    // STEP 3️⃣: Normalization function (ignore “Option A:”, “Option B:”, etc.)
    const normalize = (str = "") =>
      str
        .toLowerCase()
        .replace(/^option\s*[a-d]:\s*/i, "") // removes "Option A:", "Option b:", etc.
        .replace(/[^a-z0-9]+/g, "") // keep only alphanumerics
        .trim();

    // STEP 4️⃣: Build question stats
    const questionStats = answerKey.questions.map((q, i) => ({
      questionNumber: i + 1,
      questionText: q.questionText?.trim() || "",
      correctAnswer: (q.Answer || "").trim(),
      studentAnswer: "",
      marks: Number(q.marks) || 0,
      isCorrect: false,
      isFullMarks: false,
      isPartial: false,
      obtained: 0,
    }));

    // STEP 5️⃣: Total marks from answer key
    let totalMarks = questionStats.reduce((sum, q) => sum + (q.marks || 0), 0);
    let obtainedMarks = 0;

    // STEP 6️⃣: Compare answers with partial marking for multi-select MCQ
    for (let i = 0; i < studentQuiz.questions.length; i++) {
      const studentQ = studentQuiz.questions[i];
      const correctQ = questionStats[i];

      const studentAnswer = (studentQ.Answer || studentQ.answer || "").trim();
      const correctAnswer = (correctQ.correctAnswer || "").trim();

      // Convert answers into arrays (multi-select support)
      let correctAnswers = correctAnswer
        .split(",")
        .map(a => a.trim().toUpperCase())
        .filter(a => a.length > 0);

      let studentAnswers = studentAnswer
        .split(",")
        .map(a => a.trim().toUpperCase())
        .filter(a => a.length > 0);

      let obtainedForQuestion = 0;

      if (correctAnswers.length > 0) {
        // Calculate marks per correct option
        const perOptionMark = correctQ.marks / correctAnswers.length;

        // Award marks for each correct option selected
        correctAnswers.forEach(correctOpt => {
          if (studentAnswers.includes(correctOpt)) {
            obtainedForQuestion += perOptionMark;
          }
        });
      } else {
        // Fallback to exact match if no comma-separated answers
        if (normalize(studentAnswer) === normalize(correctAnswer)) {
          obtainedForQuestion = correctQ.marks;
        }
      }

      correctQ.obtained = obtainedForQuestion;
      correctQ.isCorrect = obtainedForQuestion > 0;
      correctQ.isFullMarks = obtainedForQuestion === correctQ.marks;
      correctQ.isPartial = obtainedForQuestion > 0 && obtainedForQuestion < correctQ.marks;
      obtainedMarks += obtainedForQuestion;
      correctQ.studentAnswer = studentAnswer;
    }

    // ✅ STEP 7️⃣: Store result in MongoDB
    const resultDoc = new Result({
      enrollmentNumber,
      totalMarks,
      obtainedMarks,
      percentage: Number(((obtainedMarks / totalMarks) * 100).toFixed(2)),
      evaluatedAt: new Date(),
      questionStats,
    });

    await resultDoc.save();

    console.log(`✅ Result saved for enrollment ${enrollmentNumber}`);

    return res.status(200).json({
      message: "✅ Answers compared and result saved successfully",
      totalMarks,
      obtainedMarks,
      percentage: resultDoc.percentage,
      questionStats,
    });
  } catch (error) {
    console.error("❌ Error comparing answers:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};


//new function with partial marking


export const compareAllAnswers = async (req, res) => {
  try {
    // STEP 1: Get answer key (enrollment 0)
    const answerKey = await Quiz1.findOne({
      "documentInfo.enrollmentNumber": 0,
    });

    if (!answerKey) {
      return res.status(404).json({
        message: "❌ Answer key not found",
      });
    }

    // STEP 2: Get all students
    const students = await Quiz1.find({
      "documentInfo.enrollmentNumber": { $ne: 0 },
    });

    if (!students.length) {
      return res.status(404).json({ message: "❌ No students found" });
    }

    // STEP 3: Cleaner normalization
    const normalize = (str = "") =>
      str
        .toLowerCase()
        .replace(/^option\s*[a-d]:\s*/i, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();

    const allResults = [];

    // STEP 4: Compare every student
    for (const studentQuiz of students) {
      const questionStats = answerKey.questions.map((q, i) => ({
        questionNumber: i + 1,
        questionText: q.questionText?.trim() || "",
        correctAnswer: (q.Answer || q.answer || "").trim(),
        studentAnswer: "",
        marks: Number(q.marks) || 0,
        isCorrect: false,
        isFullMarks: false,
        isPartial: false,
        obtained: 0,
      }));

      // Total marks (same as answer key)
      let totalMarks = questionStats.reduce(
        (sum, q) => sum + (q.marks || 0),
        0
      );

      let obtainedMarks = 0;

      // Compare by index (same as your working function)
      for (let i = 0; i < studentQuiz.questions.length; i++) {
  const studentQ = studentQuiz.questions[i];
  const correctQ = questionStats[i];

  // Convert answers into arrays (multi-select support)
  let correctAnswers = [];
  let studentAnswers = [];

  // Normalize from your existing DB fields
  if (correctQ.correctAnswer) {
    correctAnswers = correctQ.correctAnswer
      .split(",")
      .map(a => a.trim().toUpperCase());
  }

  if (studentQ.Answer) {
    studentAnswers = studentQ.Answer
      .split(",")
      .map(a => a.trim().toUpperCase());
  }

  const perOptionMark = correctQ.marks / Math.max(correctAnswers.length, 1);

  let obtainedForQuestion = 0;

  // Check each correct answer
  correctAnswers.forEach(correctOpt => {
    if (studentAnswers.includes(correctOpt)) {
      obtainedForQuestion += perOptionMark;
    }
  });

  // Save student answer text
  correctQ.studentAnswer = studentAnswers.join(", ");

  // Update stats
  correctQ.obtained = obtainedForQuestion;
  correctQ.isCorrect = obtainedForQuestion > 0;
  correctQ.isFullMarks = obtainedForQuestion === correctQ.marks;
  correctQ.isPartial = obtainedForQuestion > 0 && obtainedForQuestion < correctQ.marks;

  obtainedMarks += obtainedForQuestion;
}


      const percentage =
        totalMarks > 0
          ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2))
          : 0;

      // Save result
      const result = await Result.findOneAndUpdate(
        {
          enrollmentNumber: studentQuiz.documentInfo.enrollmentNumber,
        },
        {
          enrollmentNumber: studentQuiz.documentInfo.enrollmentNumber,
          totalMarks,
          obtainedMarks,
          percentage,
          questionStats,
          evaluatedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      allResults.push(result);
    }

    // Convert to plain objects first, then sort by highest marks, then mask enrollment
    const maskedResults = allResults
      .map(r => r.toObject())
      .sort((a, b) => (b.obtainedMarks || 0) - (a.obtainedMarks || 0))
      .map(r => ({
        ...r,
        enrollmentNumber: maskEnrollment(r.enrollmentNumber)
      }));

    res.status(200).json({
      message: "✅ All students evaluated successfully",
      results: maskedResults,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
};