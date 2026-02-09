import Result from "../models/Result.js";
import QuestionAccuracy from "../models/QuestionAccuracy.js";

// Define the three sets of thresholds for difficulty analysis
const THRESHOLDS = {
    1: { easy: 70, hard: 25 }, // Case 1: Lenient
    2: { easy: 80, hard: 29 }, // Case 2: Standard
    3: { easy: 93, hard: 30 }, // Case 3: Strict
};

/**
 * Utility function to determine difficulty based on accuracy and chosen thresholds.
 */
const getDifficultyLevel = (accuracy, easyThreshold, hardThreshold) => {
    if (accuracy >= easyThreshold) {
        return "Easy";
    } 
    else if (accuracy < hardThreshold) {
        return "Hard";
    } 
    else {
        return "Medium";
    }
};

/**
 * @desc Calculates cumulative accuracy and stores the single difficulty level for the requested case.
 * @route POST /api/accuracy/calculate?case=1|2|3
 */
export const calculateAndStoreAccuracy = async (req, res) => {
    try {
        // --- 1. Get requested case from query and validate ---
        const requestedCase = req.query.case; // e.g., "1", "2", "3"

        if (!requestedCase || !['1', '2', '3'].includes(requestedCase)) {
            return res.status(400).json({ 
                error: "Invalid or missing 'case' query parameter. Must be '1', '2', or '3'.",
                suggestion: "Please use the endpoint like: /api/accuracy/calculate?case=2"
            });
        }
        
        // --- 2. Data Aggregation (remains the same) ---
        const allResults = await Result.find();
        const statsMap = new Map();

        for (const result of allResults) {
            for (const q of result.questionStats) {
                const key = q.questionNumber;

                if (!statsMap.has(key)) {
                    statsMap.set(key, {
                        questionNumber: q.questionNumber,
                        questionText: q.questionText,
                        totalAttempts: 0,
                        correctCount: 0,
                        wrongCount: 0,
                    });
                }
                const stat = statsMap.get(key);
                stat.totalAttempts++;
                if (q.isCorrect) stat.correctCount++;
                else stat.wrongCount++;
            }
        }

        // --- 3. Process Data for the Requested Case ---
        const caseNumber = parseInt(requestedCase);
        const thresholds = THRESHOLDS[caseNumber]; // Get the thresholds for the chosen case

        const finalStats = Array.from(statsMap.values()).map((q) => {
            const accuracy = (q.correctCount / q.totalAttempts) * 100;
            
            // Calculate ONLY the single difficulty level using the chosen threshold
            const difficulty = getDifficultyLevel(
                accuracy, 
                thresholds.easy, 
                thresholds.hard
            );

            return {
                ...q,
                accuracy: accuracy.toFixed(2), 
                
                // ONLY store the singular field 'difficultyLevel' (string)
                difficultyLevel: difficulty, 
                // The 'difficultyLevels' object is no longer included
            };
        });

        // --- 4. Database Update (Reverting to simple wipe/insert) ---
        // NOTE: This approach wipes all old data, so ensure your Mongoose schema 
        // for QuestionAccuracy no longer requires the 'difficultyLevels' field.
        await QuestionAccuracy.deleteMany({});
        await QuestionAccuracy.insertMany(finalStats);

        res.status(200).json({
            message: `Question accuracy statistics calculated and stored successfully using Case ${requestedCase} thresholds.`,
            data: finalStats,
        });
    } catch (err) {
        console.error("Error calculating and storing accuracy:", err);
        res.status(500).json({ error: "Failed to calculate question stats" });
    }
};