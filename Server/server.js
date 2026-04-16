import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import "colors";
import fs from "fs"; // <-- Added for file system operations
import bodyParser from "body-parser";
import authRoutes from "./routes/authRoute.js";
// import quiz from "./routes/quiz.routes.js";
import resultRoutes from "./routes/resultRoutes.js";
import questionAccuracyRoutes from "./routes/questionAccuracyRoutes.js";
import questionAnalysisyRoutes from "./routes/quizDifficultyAnalyzerRoutes.js";
import questionBankRoutes from "./routes/questionBankRoutes.js";
import subjectUploadRoutes from "./routes/subjectUploadRoutes.js";
import paperRoutes from "./routes/paperRoutes.js";
import freeOcrRoutes from "./routes/freeOcrRoutes.js";
import geminiOcrRoutes from "./routes/geminiOcrRoutes.js";
import hybridOcrRoutes from "./routes/hybridOcrRoutes.js";
import statsRoutes from "./routes/statsRoutes.js";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded form data

// --- File System Setup ---
// Ensure the temporary 'uploads' directory exists for multer
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// DB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected"))
.catch((err) => console.error("MongoDB error:", err));

// API routes
app.get("/", (req, res) => res.send("Welcome to Product API"));

// Authentication Routes
app.use("/api/v1/auth", authRoutes);


app.use(bodyParser.json());
// app.use("/api/v1/quiz", quiz); 
app.use("/api/v1/results", resultRoutes);
app.use("/api/v1/accuracy", questionAccuracyRoutes);
app.use("/api/v1/analysis", questionAnalysisyRoutes);
app.use("/api/v1/question-bank", questionBankRoutes);
app.use("/api/v1/subject-upload", subjectUploadRoutes);
app.use("/api/v1/papers", paperRoutes);
app.use("/api/v1/free-ocr", freeOcrRoutes);
app.use("/api/v1/gemini-ocr", geminiOcrRoutes);
app.use("/api/v1/hybrid-ocr", hybridOcrRoutes);
app.use("/api/v1/stats", statsRoutes);





const PORT = process.env.PORT || 8080;
app.listen(PORT,() => {
  console.log(
    `🚀 Server running in ${process.env.DEV_MODE} mode on port ${PORT}`.bgCyan
      .white
  );
    console.log('--- OCR Microservice Requirement ---');
});
