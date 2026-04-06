import QuestionBank from "../models/QuestionBank.js";
import Quiz1 from "../models/quiz_new.js";

// Normalize question text for duplicate comparison
const normalizeText = (text) => {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars except spaces
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
};

// Add questions to the question bank (handles duplicates)
export const addToQuestionBank = async (subject, questions, fileName, subjectId = null) => {
  try {
    if (!subject || !questions || questions.length === 0) {
      return { success: false, message: "Subject and questions are required" };
    }

    const normalizedSubject = subject.toUpperCase();

    // Find or create the question bank for this subject
    let bank = await QuestionBank.findOne({ subjectName: normalizedSubject });

    if (!bank) {
      bank = new QuestionBank({
        subject: subjectId, // ObjectId reference (can be null if not provided)
        subjectName: normalizedSubject,
        questions: []
      });
    }

    let addedCount = 0;
    let duplicateCount = 0;

    for (const newQuestion of questions) {
      const normalizedNewText = normalizeText(newQuestion.questionText);

      // Check if question already exists
      const existingIndex = bank.questions.findIndex(
        (q) => normalizeText(q.questionText) === normalizedNewText
      );

      // Handle both capitalized and lowercase answer field names
      const answerValue = newQuestion.answer || newQuestion.Answer || "";

      if (existingIndex !== -1) {
        // Duplicate found - increment frequency and add source file
        bank.questions[existingIndex].frequency += 1;
        if (!bank.questions[existingIndex].sourceFiles.includes(fileName)) {
          bank.questions[existingIndex].sourceFiles.push(fileName);
        }
        duplicateCount++;
      } else {
        // New question - add to bank
        bank.questions.push({
          questionText: newQuestion.questionText,
          questionType: newQuestion.questionType || "",
          marks: newQuestion.marks || 0,
          options: newQuestion.options || [],
          answer: answerValue,
          frequency: 1,
          sourceFiles: [fileName],
          addedAt: new Date()
        });
        addedCount++;
      }
    }

    await bank.save();

    return {
      success: true,
      message: `Added ${addedCount} new questions, ${duplicateCount} duplicates merged`,
      addedCount,
      duplicateCount,
      totalQuestions: bank.totalQuestions
    };
  } catch (error) {
    console.error("Error adding to question bank:", error);
    return { success: false, message: error.message };
  }
};

// Get all questions for a subject
export const getQuestionBank = async (req, res) => {
  try {
    const { subject } = req.params;

    if (!subject) {
      return res.status(400).json({ error: "Subject is required" });
    }

    // Query by subjectName (string) not subject (ObjectId)
    const bank = await QuestionBank.findOne({
      subjectName: subject.toUpperCase()
    });

    if (!bank) {
      return res.status(200).json({
        questionBank: {
          subjectName: subject.toUpperCase(),
          questions: [],
          totalQuestions: 0
        },
        message: "No questions found for this subject"
      });
    }

    res.status(200).json({
      questionBank: {
        _id: bank._id,
        subject: bank.subject,
        subjectName: bank.subjectName,
        questions: bank.questions,
        totalQuestions: bank.totalQuestions,
        lastUpdated: bank.updatedAt
      }
    });
  } catch (error) {
    console.error("Error fetching question bank:", error);
    res.status(500).json({ error: "Failed to fetch question bank" });
  }
};

// Get all subjects with question counts
export const getAllSubjects = async (req, res) => {
  try {
    const banks = await QuestionBank.find({}, "subjectName totalQuestions updatedAt");

    const subjects = banks.map((bank) => ({
      subject: bank.subjectName,
      totalQuestions: bank.totalQuestions,
      lastUpdated: bank.updatedAt
    }));

    res.status(200).json({ subjects });
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
};

// Generate a random quiz from the question bank
export const generateQuiz = async (req, res) => {
  try {
    const { subject, count = 10 } = req.body;

    if (!subject) {
      return res.status(400).json({ error: "Subject is required" });
    }

    const bank = await QuestionBank.findOne({
      subjectName: subject.toUpperCase()
    });

    if (!bank || bank.questions.length === 0) {
      return res.status(404).json({
        error: "No questions found for this subject"
      });
    }

    // Get requested number of questions (or all if fewer available)
    const questionCount = Math.min(count, bank.questions.length);

    // Shuffle and select questions
    const shuffled = [...bank.questions].sort(() => 0.5 - Math.random());
    const selectedQuestions = shuffled.slice(0, questionCount);

    res.status(200).json({
      subject: bank.subjectName,
      questionCount: selectedQuestions.length,
      totalAvailable: bank.totalQuestions,
      questions: selectedQuestions.map((q, index) => ({
        questionNumber: index + 1,
        questionText: q.questionText,
        questionType: q.questionType,
        marks: q.marks,
        options: q.options,
        answer: q.answer
      }))
    });
  } catch (error) {
    console.error("Error generating quiz:", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
};

// Manually add questions to bank (API endpoint)
export const addQuestions = async (req, res) => {
  try {
    const { subject, questions, fileName } = req.body;

    if (!subject || !questions) {
      return res.status(400).json({
        error: "Subject and questions are required"
      });
    }

    const result = await addToQuestionBank(
      subject,
      questions,
      fileName || "manual_upload"
    );

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error("Error adding questions:", error);
    res.status(500).json({ error: "Failed to add questions" });
  }
};

// Migrate existing Quiz1 documents to Question Bank
export const migrateExistingQuizzes = async (req, res) => {
  try {
    const { subject, answerKeyOnly } = req.body;

    if (!subject) {
      return res.status(400).json({
        error: "Subject is required for migration"
      });
    }

    // Fetch Quiz1 documents - either answer key only (enrollment 0) or all
    let existingQuizzes;
    if (answerKeyOnly) {
      // Only get the answer key (enrollment number = 0)
      existingQuizzes = await Quiz1.find({
        "documentInfo.enrollmentNumber": 0
      });
    } else {
      existingQuizzes = await Quiz1.find({});
    }

    if (existingQuizzes.length === 0) {
      return res.status(200).json({
        message: answerKeyOnly
          ? "No answer key found (enrollment 0)"
          : "No existing quizzes found to migrate",
        migrated: 0
      });
    }

    let totalAdded = 0;
    let totalDuplicates = 0;
    let quizzesMigrated = 0;

    for (const quiz of existingQuizzes) {
      if (quiz.questions && quiz.questions.length > 0) {
        const result = await addToQuestionBank(
          subject,
          quiz.questions,
          quiz.file_name || "legacy_quiz"
        );

        if (result.success) {
          totalAdded += result.addedCount;
          totalDuplicates += result.duplicateCount;
          quizzesMigrated++;
        }
      }
    }

    res.status(200).json({
      success: true,
      message: `Migration complete! ${quizzesMigrated} ${answerKeyOnly ? 'answer key' : 'quizzes'} processed.`,
      quizzesMigrated,
      totalQuestionsAdded: totalAdded,
      duplicatesMerged: totalDuplicates,
      subject: subject.toUpperCase()
    });
  } catch (error) {
    console.error("Error migrating quizzes:", error);
    res.status(500).json({ error: "Failed to migrate existing quizzes" });
  }
};

// Clear question bank for a subject
export const clearQuestionBank = async (req, res) => {
  try {
    const { subject } = req.body;

    if (!subject) {
      return res.status(400).json({ error: "Subject is required" });
    }

    const result = await QuestionBank.findOneAndDelete({
      subjectName: subject.toUpperCase()
    });

    if (result) {
      res.status(200).json({
        success: true,
        message: `Cleared ${result.totalQuestions} questions from ${subject.toUpperCase()} question bank`
      });
    } else {
      res.status(200).json({
        success: true,
        message: `No question bank found for ${subject.toUpperCase()}`
      });
    }
  } catch (error) {
    console.error("Error clearing question bank:", error);
    res.status(500).json({ error: "Failed to clear question bank" });
  }
};

// Delete a specific question from the question bank
export const deleteQuestion = async (req, res) => {
  try {
    const { subject, questionId } = req.params;

    if (!subject || !questionId) {
      return res.status(400).json({ error: "Subject and questionId are required" });
    }

    const bank = await QuestionBank.findOne({
      subjectName: subject.toUpperCase()
    });

    if (!bank) {
      return res.status(404).json({ error: "Question bank not found" });
    }

    // Find and remove the question
    const questionIndex = bank.questions.findIndex(
      q => q._id.toString() === questionId
    );

    if (questionIndex === -1) {
      return res.status(404).json({ error: "Question not found" });
    }

    const deletedQuestion = bank.questions.splice(questionIndex, 1)[0];
    await bank.save();

    res.status(200).json({
      success: true,
      message: "Question deleted successfully",
      deletedQuestion: deletedQuestion.questionText.substring(0, 50) + "..."
    });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
};
