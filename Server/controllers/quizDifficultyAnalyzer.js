import QuestionAccuracy from "../models/QuestionAccuracy.js";

/**
 * @desc Get quiz summary with difficulty and overall performance
 * @route GET /api/quiz/summary
 */
export const getQuizSummary = async (req, res) => {
  try {
    const questions = await QuestionAccuracy.find();

    if (questions.length === 0) {
      return res.status(404).json({ message: "No question data found" });
    }

    // ── STEP 1: Calculate accuracy for each question ────────────────────────
    const questionsWithAccuracy = questions.map(q => {
      const accuracy = q.totalAttempts
        ? (q.correctCount / q.totalAttempts) * 100
        : 0;
      return { ...q.toObject(), calculatedAccuracy: accuracy };
    });

    // ── STEP 2: Calculate Mean (μ) and Standard Deviation (σ) ───────────────
    const accuracies = questionsWithAccuracy.map(q => q.calculatedAccuracy);
    const mean = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;

    const squaredDiffs = accuracies.map(acc => Math.pow(acc - mean, 2));
    const variance = squaredDiffs.reduce((sum, sq) => sum + sq, 0) / accuracies.length;
    const stdDev = Math.sqrt(variance);

    // ── STEP 3: Classify difficulty using Normal Distribution Zones ─────────
    // Easy Zone:   x ≥ μ         (top 50% - above or equal to mean)
    // Medium Zone: μ - σ ≤ x < μ (middle ~34.1% - between mean-1σ and mean)
    // Hard Zone:   x < μ - σ     (bottom ~15.9% - below mean-1σ)
    const summary = questionsWithAccuracy.map(q => {
      let difficulty;
      if (q.calculatedAccuracy >= mean) {
        difficulty = "Easy";       // x ≥ μ (top 50%)
      } else if (q.calculatedAccuracy >= (mean - stdDev)) {
        difficulty = "Medium";     // μ - σ ≤ x < μ (~34.1%)
      } else {
        difficulty = "Hard";       // x < μ - σ (bottom ~15.9%)
      }

      return {
        questionNumber: q.questionNumber,
        questionText: q.questionText,
        accuracy: q.calculatedAccuracy.toFixed(2) + "%",
        difficulty
      };
    });

    // Calculate overall quiz stats
    const totalCorrect = questions.reduce((sum, q) => sum + q.correctCount, 0);
    const totalAttempts = questions.reduce((sum, q) => sum + q.totalAttempts, 0);
    const overallAccuracy = totalAttempts ? (totalCorrect / totalAttempts) * 100 : 0;

    // Overall difficulty based on where overall accuracy falls
    let overallDifficulty;
    if (overallAccuracy >= mean) {
      overallDifficulty = "Easy";
    } else if (overallAccuracy >= (mean - stdDev)) {
      overallDifficulty = "Medium";
    } else {
      overallDifficulty = "Hard";
    }

    res.json({
      summary,
      overall: {
        totalQuestions: questions.length,
        overallAccuracy: overallAccuracy.toFixed(2) + "%",
        overallDifficulty,
        mean: mean.toFixed(2) + "%",
        stdDev: stdDev.toFixed(2) + "%"
      }
    });

  } catch (error) {
    console.error("Error generating quiz summary:", error);
    res.status(500).json({ message: "Server error" });
  }
};

export const analyzeQuizPerformance = async (req, res) => {
  try {
    const data = await QuestionAccuracy.find();

    if (!data || data.length === 0)
      return res.status(404).json({ message: "No question data found" });

    // STEP 1: Extract relevant metrics
    const accuracies = data.map(q => q.accuracy || 0); // in %
    const totalQuestions = data.length;

    // STEP 2: Compute average accuracy
    const avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / totalQuestions;

    // STEP 3: Compute standard deviation (to check consistency)
    const mean = avgAccuracy;
    const variance = accuracies.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / totalQuestions;
    const stdDev = Math.sqrt(variance);

    // STEP 4: Compute difficulty index per question (1 - accuracy%)
    const difficultyIndices = accuracies.map(a => 1 - a / 100);
    const avgDifficultyIndex = difficultyIndices.reduce((a, b) => a + b, 0) / totalQuestions;

    // STEP 5: Compute Quiz Intelligence Score (QIS)
    // Lower avgAccuracy → harder quiz
    // Higher stdDev → less consistent performance
    // Higher avgDifficultyIndex → harder quiz
    const QIS = (avgAccuracy * 0.6) + ((100 - stdDev * 2) * 0.3) + ((1 - avgDifficultyIndex) * 100 * 0.1);

    // STEP 6: Derive difficulty level using Normal Distribution Zones
    // Easy Zone:   x ≥ μ         (top 50% - above or equal to mean)
    // Medium Zone: μ - σ ≤ x < μ (middle ~34.1% - between mean-1σ and mean)
    // Hard Zone:   x < μ - σ     (bottom ~15.9% - below mean-1σ)
    let overallLevel;
    if (avgAccuracy >= mean) {
      overallLevel = "Easy";       // x ≥ μ (top 50%)
    } else if (avgAccuracy >= (mean - stdDev)) {
      overallLevel = "Medium";     // μ - σ ≤ x < μ (~34.1%)
    } else {
      overallLevel = "Hard";       // x < μ - σ (bottom ~15.9%)
    }

    // STEP 7: Print internal calculations
    console.log("==== Quiz Performance Deep Analysis ====");
    console.log("Total Questions:", totalQuestions);
    console.log("Accuracies:", accuracies.map(a => a.toFixed(2)).join(", "));
    console.log("Average Accuracy:", avgAccuracy.toFixed(2));
    console.log("Std Deviation:", stdDev.toFixed(2));
    console.log("Avg Difficulty Index:", avgDifficultyIndex.toFixed(3));
    console.log("Quiz Intelligence Score (QIS):", QIS.toFixed(2));
    console.log("Overall Level:", overallLevel);
    console.log("=========================================");

    // STEP 8: Return JSON response
    res.json({
      totalQuestions,
      avgAccuracy: avgAccuracy.toFixed(2),
      stdDeviation: stdDev.toFixed(2),
      avgDifficultyIndex: avgDifficultyIndex.toFixed(3),
      QIS: QIS.toFixed(2),
      overallLevel,
    });
  } catch (err) {
    console.error("Error analyzing quiz:", err);
    res.status(500).json({ message: "Server error analyzing quiz" });
  }
};