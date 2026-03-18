import User from "../models/userModels.js";
import Paper from "../models/Paper.js";
import Result from "../models/Result.js";
import Subject from "../models/Subject.js";

// Get dashboard stats
export const getDashboardStats = async (req, res) => {
  try {
    // Get counts in parallel for better performance
    const [
      activeUsers,
      quizzesCreated,
      totalSubjects,
      resultsData
    ] = await Promise.all([
      User.countDocuments(),
      Paper.countDocuments(),
      Subject.countDocuments(),
      Result.aggregate([
        {
          $group: {
            _id: null,
            averageScore: { $avg: "$percentage" },
            totalAttempts: { $sum: 1 }
          }
        }
      ])
    ]);

    // Extract average score from aggregation result
    const averageScore = resultsData.length > 0
      ? Math.round(resultsData[0].averageScore * 10) / 10
      : 0;

    const totalAttempts = resultsData.length > 0
      ? resultsData[0].totalAttempts
      : 0;

    res.status(200).json({
      success: true,
      stats: {
        activeUsers,
        quizzesCreated,
        totalSubjects,
        averageScore,
        totalAttempts
      }
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch stats",
      error: error.message
    });
  }
};
