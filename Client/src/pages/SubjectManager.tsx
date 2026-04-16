import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  BookOpen,
  FileText,
  Upload as UploadIcon,
  Users,
  BarChart3,
  CheckCircle,
  XCircle,
  Loader2,
  FolderOpen,
  Key,
  GraduationCap,
  ChevronRight,
  Eye,
  EyeOff,
  Play,
  AlertCircle,
  Database,
  Search,
  Filter,
  HelpCircle,
  Hash,
  TrendingUp,
  Target,
  Zap,
  Sparkles
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import AnalysisBarGraph from './AnalysisBarGraph';
import AnalysisPieChart from './AnalysisPieChart';

// V1 API
const API_BASE_URL = "http://localhost:8080/api/v1/papers";
const QUESTION_BANK_URL = "http://localhost:8080/api/v1/question-bank";
const FREE_OCR_URL = "http://localhost:8080/api/v1/free-ocr";
const GEMINI_OCR_URL = "http://localhost:8080/api/v1/gemini-ocr";

interface Subject {
  _id: string;
  name: string;
  code: string;
  description: string;
  totalPapers: number;
  totalQuestions?: number;
}

interface Quiz {
  _id: string;
  paperName: string;
  paperNumber: number;
  totalMarks: number;
  totalStudents?: number;
  key?: {
    uploadedAt: string;
    questions: any[];
  };
  studentResponses?: any[];
  createdAt: string;
}

interface Result {
  _id: string;
  enrollmentNumber: string;
  obtainedMarks: number;
  totalMarks?: number;
  percentage: number;
  grade: string;
  answers?: any[];
  questionStats?: any[];
  summary?: {
    totalQuestions: number;
    fullCorrect: number;
    partialCorrect: number;
    wrong: number;
    attempted: number;
  };
}

interface QuizAnalytics {
  results: Result[];
  analytics: {
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    passRate: number;
  } | null;
  paperName: string;
  subjectName: string;
}

interface QuestionBankQuestion {
  _id: string;
  questionText: string;
  questionType: string;
  marks: number;
  options: string[];
  answer: string;
  frequency: number;
  sourceFiles: string[];
  addedAt: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard' | 'Not Analyzed';
  difficultyStats?: {
    totalAttempts?: number;
    correctCount?: number;
    partialCount?: number;
    wrongCount?: number;
    accuracy?: number;
    avgScore?: number;
    lastAnalyzedAt?: string | null;
  };
}

interface QuestionBank {
  _id: string;
  subject: string;
  subjectName: string;
  questions: QuestionBankQuestion[];
  totalQuestions: number;
}

interface QuestionAnalysis {
  questionNumber: number;
  questionText: string;
  totalAttempts: number;
  correctCount: number;
  partialCount: number;
  wrongCount: number;
  accuracy: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

const getDifficultyColorClass = (difficulty: string) => {
  switch (difficulty) {
    case 'Easy': return 'text-green-600 bg-green-100';
    case 'Medium': return 'text-yellow-600 bg-yellow-100';
    case 'Hard': return 'text-red-600 bg-red-100';
    default: return 'text-gray-600 bg-gray-100';
  }
};

// Match backend difficulty zones exactly:
// Easy:   x >= mean
// Medium: mean - stdDev <= x < mean
// Hard:   x < mean - stdDev
const calculateDifficultyByClassMean = (
  questionAccuracies: number[]
): { mean: number; stdDev: number; getDifficulty: (accuracy: number) => 'Easy' | 'Medium' | 'Hard' } => {
  if (questionAccuracies.length === 0) {
    return { mean: 0, stdDev: 0, getDifficulty: () => 'Medium' };
  }

  // Calculate mean
  const mean = questionAccuracies.reduce((sum, acc) => sum + acc, 0) / questionAccuracies.length;

  // Calculate standard deviation
  const squaredDiffs = questionAccuracies.map(acc => Math.pow(acc - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / questionAccuracies.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // Return function to classify difficulty using backend zones
  const getDifficulty = (accuracy: number): 'Easy' | 'Medium' | 'Hard' => {
    if (accuracy >= mean) return 'Easy';
    if (accuracy >= (mean - stdDev)) return 'Medium';
    return 'Hard';
  };

  return { mean, stdDev, getDifficulty };
};

const SubjectManager = () => {
  const { auth } = useAuth();

  // Helper to get auth headers
  const getAuthHeaders = () => ({
    headers: { Authorization: `Bearer ${auth.token}` }
  });

  // State
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);

  // Analytics stored per quiz
  const [quizAnalyticsMap, setQuizAnalyticsMap] = useState<Record<string, QuizAnalytics>>({});

  // Derived analytics for current quiz
  const currentAnalytics = selectedQuiz?._id ? quizAnalyticsMap[selectedQuiz._id] : null;
  const results = currentAnalytics?.results || [];
  const analytics = currentAnalytics?.analytics || null;

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // Dialog states
  const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
  const [isQuizDialogOpen, setIsQuizDialogOpen] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCode, setNewSubjectCode] = useState('');
  const [newSubjectDesc, setNewSubjectDesc] = useState('');
  const [newQuizName, setNewQuizName] = useState('');

  // Upload states
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [studentFiles, setStudentFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState({ type: '', text: '' });
  const [ocrProvider, setOcrProvider] = useState<'groq' | 'landing' | 'gemini'>('groq'); // OCR provider selection

  // View states
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('quizzes');
  const [visibleResultsCount, setVisibleResultsCount] = useState(5); // Pagination for student results

  // Question Bank states
  const [questionBank, setQuestionBank] = useState<QuestionBank | null>(null);
  const [isLoadingQuestionBank, setIsLoadingQuestionBank] = useState(false);
  const [questionBankSearch, setQuestionBankSearch] = useState('');
  const [questionBankFilter, setQuestionBankFilter] = useState<'all' | 'MCQ' | 'SHORT' | 'LONG' | 'TRUE_FALSE'>('all');
  const [questionBankDifficultyFilter, setQuestionBankDifficultyFilter] = useState<'all' | 'Easy' | 'Medium' | 'Hard'>('all');

  const keyFileRef = useRef<HTMLInputElement>(null);
  const studentFileRef = useRef<HTMLInputElement>(null);

  // Fetch subjects on mount
  useEffect(() => {
    fetchSubjects();
  }, []);

  // Fetch quizzes when subject changes
  useEffect(() => {
    if (selectedSubject) {
      fetchQuizzes(selectedSubject._id);
    }
  }, [selectedSubject]);

  // Fetch results when quiz changes
  useEffect(() => {
    if (selectedSubject && selectedQuiz?._id) {
      setVisibleResultsCount(5); // Reset pagination when quiz changes
      if (!quizAnalyticsMap[selectedQuiz._id]?.results?.length) {
        fetchQuizResults(selectedSubject._id, selectedQuiz._id);
      }
    }
  }, [selectedQuiz?._id]);

  // Fetch question bank when tab changes to questionbank
  useEffect(() => {
    if (selectedSubject && activeTab === 'questionbank') {
      fetchQuestionBank(selectedSubject.name);
    }
  }, [selectedSubject, activeTab]);

  // ==================== API CALLS ====================

  const fetchSubjects = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/subjects`, getAuthHeaders());
      setSubjects(response.data.subjects || []);
    } catch (error) {
      console.error("Error fetching subjects:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchQuizzes = async (subjectId: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/subjects/${subjectId}`, getAuthHeaders());
      setQuizzes(response.data.papers || []);
    } catch (error) {
      console.error("Error fetching quizzes:", error);
    }
  };

  const fetchQuizDetails = async (subjectId: string, quizId: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/papers/${quizId}`, getAuthHeaders());
      setSelectedQuiz(prev => prev?._id === quizId ? response.data.paper : prev);
    } catch (error) {
      console.error("Error fetching quiz details:", error);
    }
  };

  const fetchQuizResults = async (subjectId: string, quizId: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/papers/${quizId}/results`, getAuthHeaders());
      if (response.data.results?.length > 0) {
        setQuizAnalyticsMap(prev => ({
          ...prev,
          [quizId]: {
            results: response.data.results,
            analytics: response.data.analytics,
            paperName: response.data.paperName,
            subjectName: response.data.subjectName
          }
        }));
      }
    } catch (error) {
      console.error("Error fetching results:", error);
    }
  };

  const fetchQuestionBank = async (subjectName: string) => {
    try {
      setIsLoadingQuestionBank(true);
      const response = await axios.get(`${QUESTION_BANK_URL}/${encodeURIComponent(subjectName)}`, getAuthHeaders());
      if (response.data.questionBank) {
        setQuestionBank(response.data.questionBank);
      }
    } catch (error) {
      console.error("Error fetching question bank:", error);
      setQuestionBank(null);
    } finally {
      setIsLoadingQuestionBank(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!selectedSubject || !questionBank) return;
    if (!confirm('Are you sure you want to delete this question?')) return;

    try {
      const response = await axios.delete(
        `${QUESTION_BANK_URL}/${encodeURIComponent(selectedSubject.name)}/question/${questionId}`,
        getAuthHeaders()
      );

      if (response.data.success) {
        // Update local state to remove the question
        setQuestionBank({
          ...questionBank,
          questions: questionBank.questions.filter(q => q._id !== questionId),
          totalQuestions: questionBank.totalQuestions - 1
        });
        setUploadStatus({ type: 'success', text: 'Question deleted successfully' });
      }
    } catch (error) {
      console.error("Error deleting question:", error);
      setUploadStatus({ type: 'error', text: 'Failed to delete question' });
    }
  };

  // ==================== SUBJECT CRUD ====================

  const handleCreateSubject = async () => {
    if (!newSubjectName.trim()) return;

    try {
      setIsProcessing(true);
      const response = await axios.post(`${API_BASE_URL}/subjects`, {
        name: newSubjectName,
        code: newSubjectCode,
        description: newSubjectDesc
      }, getAuthHeaders());

      if (response.data.success) {
        setSubjects([...subjects, response.data.subject]);
        setNewSubjectName('');
        setNewSubjectCode('');
        setNewSubjectDesc('');
        setIsSubjectDialogOpen(false);
        setUploadStatus({ type: 'success', text: `Subject "${response.data.subject.name}" created!` });
      }
    } catch (error: any) {
      setUploadStatus({ type: 'error', text: error.response?.data?.message || 'Failed to create subject' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string, subjectName: string) => {
    if (!confirm(`Delete subject "${subjectName}" and ALL its quizzes?`)) return;

    try {
      await axios.delete(`${API_BASE_URL}/subjects/${subjectId}`, getAuthHeaders());
      setSubjects(subjects.filter(s => s._id !== subjectId));
      if (selectedSubject?._id === subjectId) {
        setSelectedSubject(null);
        setQuizzes([]);
        setSelectedQuiz(null);
      }
      setUploadStatus({ type: 'success', text: `Subject "${subjectName}" deleted` });
    } catch (error) {
      setUploadStatus({ type: 'error', text: 'Failed to delete subject' });
    }
  };

  // ==================== QUIZ CRUD ====================

  const handleCreateQuiz = async () => {
    if (!selectedSubject) return;

    try {
      setIsProcessing(true);
      const response = await axios.post(
        `${API_BASE_URL}/subjects/${selectedSubject._id}/papers`,
        { paperName: newQuizName || `Paper ${quizzes.length + 1}` },
        getAuthHeaders()
      );

      if (response.data.success) {
        setQuizzes([...quizzes, response.data.paper]);
        setNewQuizName('');
        setIsQuizDialogOpen(false);
        setUploadStatus({ type: 'success', text: `Paper "${response.data.paper.paperName}" created!` });
      }
    } catch (error: any) {
      setUploadStatus({ type: 'error', text: error.response?.data?.message || 'Failed to create quiz' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteQuiz = async (quizId: string, paperName: string) => {
    if (!selectedSubject || !confirm(`Delete quiz "${paperName}"?`)) return;

    try {
      await axios.delete(`${API_BASE_URL}/papers/${quizId}`, getAuthHeaders());
      setQuizzes(quizzes.filter(q => q._id !== quizId));
      if (selectedQuiz?._id === quizId) {
        setSelectedQuiz(null);
      }
      // Remove from analytics map
      setQuizAnalyticsMap(prev => {
        const newMap = { ...prev };
        delete newMap[quizId];
        return newMap;
      });
      setUploadStatus({ type: 'success', text: `Quiz "${paperName}" deleted` });
    } catch (error) {
      setUploadStatus({ type: 'error', text: 'Failed to delete quiz' });
    }
  };

  // ==================== UPLOADS ====================

  const handleKeyUpload = async () => {
    if (!selectedSubject || !selectedQuiz || !keyFile) {
      setUploadStatus({ type: 'error', text: 'Please select a file' });
      return;
    }

    try {
      setIsProcessing(true);
      const providerName = ocrProvider === 'groq' ? 'Groq Vision (Free)' : ocrProvider === 'gemini' ? 'Google Gemini (Free)' : 'Landing AI';
      setUploadStatus({ type: 'info', text: `Extracting with ${providerName}...` });

      const formData = new FormData();
      formData.append('file', keyFile);

      let extractedData;

      if (ocrProvider === 'groq') {
        // Use FREE Groq OCR service
        const extractResponse = await axios.post(
          `${FREE_OCR_URL}/extract-key`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }
        );
        extractedData = extractResponse.data;
      } else if (ocrProvider === 'gemini') {
        // Use Google Gemini OCR service
        const extractResponse = await axios.post(
          `${GEMINI_OCR_URL}/extract-key`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }
        );
        extractedData = extractResponse.data;
      } else {
        // Use Landing AI (existing endpoint)
        const response = await axios.post(
          `${API_BASE_URL}/papers/${selectedQuiz._id}/key`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${auth.token}` } }
        );

        if (response.data.success) {
          setUploadStatus({
            type: 'success',
            text: `Answer key uploaded! ${response.data.totalQuestions} questions, ${response.data.totalMarks} marks`
          });
          setKeyFile(null);
          if (keyFileRef.current) keyFileRef.current.value = '';
          fetchQuizzes(selectedSubject._id);
          fetchQuizDetails(selectedSubject._id, selectedQuiz._id);
        }
        return;
      }

      // For Groq: Save extracted data to paper
      if (extractedData?.success) {
        console.log('📋 Extracted questions:', extractedData.questions?.length);
        console.log('📋 Questions:', extractedData.questions);
        setUploadStatus({ type: 'info', text: `Saving ${extractedData.questions?.length || 0} questions...` });

        const saveResponse = await axios.post(
          `${API_BASE_URL}/papers/${selectedQuiz._id}/key-data`,
          {
            questions: extractedData.questions,
            documentInfo: extractedData.documentInfo,
            totalMarks: extractedData.totalMarks,
            fileName: keyFile.name
          },
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );

        if (saveResponse.data.success) {
          const providerLabel = ocrProvider === 'groq' ? 'Groq Free' : 'Gemini Free';
          setUploadStatus({
            type: 'success',
            text: `Answer key uploaded! ${extractedData.totalQuestions} questions, ${extractedData.totalMarks} marks (${providerLabel})`
          });
          setKeyFile(null);
          if (keyFileRef.current) keyFileRef.current.value = '';
          fetchQuizzes(selectedSubject._id);
          fetchQuizDetails(selectedSubject._id, selectedQuiz._id);
        }
      } else {
        throw new Error(extractedData?.message || 'Extraction failed');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || 'Failed to upload key';
      setUploadStatus({ type: 'error', text: errorMsg });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStudentUpload = async () => {
    if (!selectedSubject || !selectedQuiz) return;

    if (studentFiles.length === 0) {
      setUploadStatus({ type: 'error', text: 'Please select files' });
      return;
    }

    try {
      setIsProcessing(true);
      const providerName = ocrProvider === 'groq' ? 'Groq Vision (Free)' : ocrProvider === 'gemini' ? 'Google Gemini (Free)' : 'Landing AI';
      setUploadStatus({ type: 'info', text: `Processing ${studentFiles.length} responses with ${providerName}...` });

      if (ocrProvider === 'groq' || ocrProvider === 'gemini') {
        // Use FREE Groq or Gemini OCR for each file
        const ocrUrl = ocrProvider === 'groq' ? FREE_OCR_URL : GEMINI_OCR_URL;
        const ocrLabel = ocrProvider === 'groq' ? 'Groq' : 'Gemini';
        const results = [];

        // Build question_types map from answer key (ensures student response types match)
        const questionTypesMap: Record<string, string> = {};
        if (selectedQuiz?.key?.questions) {
          selectedQuiz.key.questions.forEach((q: any, idx: number) => {
            questionTypesMap[String(idx + 1)] = q.questionType || 'MCQ';
          });
        }
        const questionTypesJson = Object.keys(questionTypesMap).length > 0
          ? JSON.stringify(questionTypesMap)
          : '';

        for (let i = 0; i < studentFiles.length; i++) {
          const file = studentFiles[i];
          setUploadStatus({ type: 'info', text: `Processing file ${i + 1}/${studentFiles.length} with ${ocrLabel}...` });

          const formData = new FormData();
          formData.append('file', file);
          // Pass question types from answer key so student response types match
          if (questionTypesJson) {
            formData.append('question_types', questionTypesJson);
          }

          try {
            const extractResponse = await axios.post(
              `${ocrUrl}/extract-response`,
              formData,
              { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000 }
            );

            if (extractResponse.data.success) {
              // Save to paper
              await axios.post(
                `${API_BASE_URL}/papers/${selectedQuiz._id}/response-data`,
                {
                  enrollmentNumber: extractResponse.data.enrollmentNumber,
                  answers: extractResponse.data.answers,
                  fileName: file.name
                },
                { headers: { Authorization: `Bearer ${auth.token}` } }
              );
              results.push({ file: file.name, status: 'success' });
            }
          } catch (err: any) {
            results.push({ file: file.name, status: 'failed', error: err.message });
          }
        }

        const successCount = results.filter(r => r.status === 'success').length;
        setUploadStatus({
          type: successCount > 0 ? 'success' : 'error',
          text: `Processed ${successCount}/${studentFiles.length} files with ${ocrLabel} (Free)`
        });
      } else {
        // Use Landing AI (existing endpoint)
        const formData = new FormData();
        studentFiles.forEach(file => formData.append('files', file));

        const response = await axios.post(
          `${API_BASE_URL}/papers/${selectedQuiz._id}/responses`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${auth.token}` } }
        );

        if (response.data.success) {
          setUploadStatus({ type: 'success', text: response.data.message });
        }
      }

      setStudentFiles([]);
      if (studentFileRef.current) studentFileRef.current.value = '';
      fetchQuizzes(selectedSubject._id);
      fetchQuizDetails(selectedSubject._id, selectedQuiz._id);
    } catch (error: any) {
      setUploadStatus({ type: 'error', text: error.response?.data?.message || 'Failed to upload responses' });
    } finally {
      setIsProcessing(false);
    }
  };

  // ==================== EVALUATE ====================

  // Check if quiz has subjective questions (SHORT or LONG)
  const hasSubjectiveQuestions = (quiz: Quiz | null): boolean => {
    if (!quiz?.key?.questions) return false;
    return quiz.key.questions.some(
      (q: any) => q.questionType === 'SHORT' || q.questionType === 'LONG'
    );
  };

  const handleEvaluate = async () => {
    if (!selectedSubject || !selectedQuiz) return;

    try {
      setIsEvaluating(true);

      // Check if paper has subjective questions
      const isSubjective = hasSubjectiveQuestions(selectedQuiz);

      if (isSubjective) {
        setUploadStatus({ type: 'info', text: 'Evaluating with AI (subjective questions detected)...' });

        // Use the new subjective evaluation endpoint
        const response = await axios.post(
          `${FREE_OCR_URL}/evaluate-paper/${selectedQuiz._id}`,
          {},
          getAuthHeaders()
        );

        if (response.data.success) {
          setUploadStatus({ type: 'success', text: `Evaluated ${response.data.results.length} students with AI!` });

          // Store in analytics map
          setQuizAnalyticsMap(prev => ({
            ...prev,
            [selectedQuiz._id]: {
              results: response.data.results,
              analytics: {
                averageScore: Number(response.data.classStats.averagePercentage),
                highestScore: response.data.classStats.highestScore,
                lowestScore: response.data.classStats.lowestScore,
                passRate: Number(response.data.classStats.passRate)
              },
              paperName: response.data.paperName,
              subjectName: response.data.subjectName
            }
          }));

          setActiveTab('analytics');
          await fetchQuestionBank(selectedSubject.name);
        }
      } else {
        setUploadStatus({ type: 'info', text: 'Evaluating...' });

        // Use the standard MCQ evaluation endpoint
        const response = await axios.post(
          `${API_BASE_URL}/papers/${selectedQuiz._id}/evaluate`,
          {},
          getAuthHeaders()
        );

        if (response.data.success) {
          setUploadStatus({ type: 'success', text: `Evaluated ${response.data.results.length} students!` });

          // Store in analytics map
          setQuizAnalyticsMap(prev => ({
            ...prev,
            [selectedQuiz._id]: {
              results: response.data.results,
              analytics: response.data.analytics,
              paperName: response.data.paperName,
              subjectName: response.data.subjectName
            }
          }));

          setActiveTab('analytics');
          await fetchQuestionBank(selectedSubject.name);
        }
      }
    } catch (error: any) {
      setUploadStatus({ type: 'error', text: error.response?.data?.message || 'Evaluation failed' });
    } finally {
      setIsEvaluating(false);
    }
  };

  // ==================== DELETE STUDENT RESULT ====================

  const handleDeleteStudentResult = async (resultId: string, enrollmentNumber: string) => {
    if (!selectedSubject || !selectedQuiz) return;
    if (!confirm(`Delete result for student ${enrollmentNumber}?`)) return;

    try {
      const response = await axios.delete(
        `${API_BASE_URL}/papers/${selectedQuiz._id}/results/${resultId}`,
        getAuthHeaders()
      );

      if (response.data.success) {
        // Remove from local analytics map
        setQuizAnalyticsMap(prev => {
          const currentQuizAnalytics = prev[selectedQuiz._id];
          if (!currentQuizAnalytics) return prev;

          const updatedResults = currentQuizAnalytics.results.filter(
            r => r._id !== resultId
          );

          // Recalculate analytics
          const newAnalytics = updatedResults.length > 0 ? {
            averageScore: Number((updatedResults.reduce((sum, r) => sum + r.percentage, 0) / updatedResults.length).toFixed(2)),
            highestScore: Math.max(...updatedResults.map(r => r.percentage)),
            lowestScore: Math.min(...updatedResults.map(r => r.percentage)),
            passRate: Number(((updatedResults.filter(r => r.percentage >= 40).length / updatedResults.length) * 100).toFixed(2))
          } : null;

          return {
            ...prev,
            [selectedQuiz._id]: {
              ...currentQuizAnalytics,
              results: updatedResults,
              analytics: newAnalytics
            }
          };
        });

        // Refresh quiz details
        fetchQuizzes(selectedSubject._id);
        fetchQuizDetails(selectedSubject._id, selectedQuiz._id);
        setUploadStatus({ type: 'success', text: `Deleted student ${enrollmentNumber}` });
      }
    } catch (error: any) {
      setUploadStatus({ type: 'error', text: error.response?.data?.message || 'Failed to delete student' });
    }
  };

  // ==================== HELPERS ====================

  // Calculate question-wise analysis from results using class mean for difficulty
  const calculateQuestionAnalysis = (): {
    questions: QuestionAnalysis[];
    classMean: number;
    stdDev: number
  } => {
    if (!results.length || !selectedQuiz?.key?.questions) {
      return { questions: [], classMean: 0, stdDev: 0 };
    }

    const questions = selectedQuiz.key.questions;
    const totalStudents = results.length;

    // Step 1: Calculate accuracy exactly like backend difficulty update
    // (full-correct only; partial/wrong tracked separately for display)
    const questionData = questions.map((q: any, idx: number) => {
      let correctCount = 0;
      let partialCount = 0;
      let wrongCount = 0;

      results.forEach((result) => {
        // Check both questionStats (from Result model) and answers (fallback)
        const studentAnswers = result.questionStats || result.answers || [];
        const answer = studentAnswers[idx];
        if (answer) {
          // Use backend flags directly: isFullMarks for correct, isPartial for partial
          if (answer.isFullMarks) {
            correctCount++;
          } else if (answer.isPartial) {
            partialCount++;
          } else {
            wrongCount++;
          }
        } else {
          wrongCount++;
        }
      });

      // Backend uses full-correct ratio for difficulty accuracy.
      const accuracy = totalStudents > 0
        ? (correctCount / totalStudents) * 100
        : 0;

      return {
        questionNumber: idx + 1,
        questionText: q.questionText || `Question ${idx + 1}`,
        totalAttempts: totalStudents,
        correctCount,
        partialCount,
        wrongCount,
        accuracy
      };
    });

    // Step 2: Calculate class mean and standard deviation for difficulty classification
    const accuracies = questionData.map(q => q.accuracy);
    const { mean, stdDev, getDifficulty } = calculateDifficultyByClassMean(accuracies);

    // Step 3: Assign difficulty based on class mean comparison
    const questionsWithDifficulty: QuestionAnalysis[] = questionData.map(q => ({
      ...q,
      difficulty: getDifficulty(q.accuracy)
    }));

    return { questions: questionsWithDifficulty, classMean: mean, stdDev };
  };

  // Get the analysis data (memoized-like pattern)
  const analysisResult = calculateQuestionAnalysis();
  const questionAnalysis = analysisResult.questions;
  const classMeanAccuracy = analysisResult.classMean;
  const classStdDev = analysisResult.stdDev;

  // Read difficulty directly from MongoDB-backed question bank.
  const getQuestionDifficulty = (question: QuestionBankQuestion): 'Easy' | 'Medium' | 'Hard' | 'Not Analyzed' => {
    return question.difficulty || 'Not Analyzed';
  };

  // Get difficulty counts for question bank
  const getQuestionBankDifficultyCounts = () => {
    if (!questionBank || questionBank.questions.length === 0) {
      return { Easy: 0, Medium: 0, Hard: 0, 'Not Analyzed': 0 };
    }

    const counts = { Easy: 0, Medium: 0, Hard: 0, 'Not Analyzed': 0 };
    questionBank.questions.forEach(q => {
      const difficulty = getQuestionDifficulty(q);
      counts[difficulty]++;
    });
    return counts;
  };

  const difficultyCounts = getQuestionBankDifficultyCounts();

  // Get difficulty distribution for pie chart
  const getDifficultyDistribution = () => {
    const distribution = { Easy: 0, Medium: 0, Hard: 0 };

    questionAnalysis.forEach(q => {
      distribution[q.difficulty]++;
    });

    return [
      { name: 'Easy', value: distribution.Easy },
      { name: 'Medium', value: distribution.Medium },
      { name: 'Hard', value: distribution.Hard }
    ].filter(item => item.value > 0);
  };

  // Prepare bar chart data
  const getBarChartData = () => {
    return questionAnalysis.map(q => ({
      questionNumber: `Q${q.questionNumber}`,
      correctCount: q.correctCount,
      accuracy: q.accuracy,
      difficulty: q.difficulty
    }));
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <GraduationCap className="h-8 w-8" />
          Subject & Quiz Manager
        </h1>

        <Dialog open={isSubjectDialogOpen} onOpenChange={setIsSubjectDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="h-4 w-4 mr-2" />
              New Subject
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Subject</DialogTitle>
              <DialogDescription>Creates a new subject with its own quiz collection.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="subject-name">Subject Name *</Label>
                <Input
                  id="subject-name"
                  placeholder="e.g., Data Structures"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="subject-code">Subject Code</Label>
                <Input
                  id="subject-code"
                  placeholder="e.g., DSA"
                  value={newSubjectCode}
                  onChange={(e) => setNewSubjectCode(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="subject-desc">Description</Label>
                <Input
                  id="subject-desc"
                  placeholder="Brief description..."
                  value={newSubjectDesc}
                  onChange={(e) => setNewSubjectDesc(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSubjectDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateSubject} disabled={!newSubjectName.trim() || isProcessing}>
                {isProcessing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create Subject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Status Message */}
      {uploadStatus.text && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
          uploadStatus.type === 'success' ? 'bg-green-100 text-green-700' :
          uploadStatus.type === 'error' ? 'bg-red-100 text-red-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {uploadStatus.type === 'success' && <CheckCircle className="h-4 w-4" />}
          {uploadStatus.type === 'error' && <XCircle className="h-4 w-4" />}
          {uploadStatus.type === 'info' && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploadStatus.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Subject List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Subjects ({subjects.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subjects.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No subjects yet</p>
              ) : (
                <div className="space-y-2">
                  {subjects.map((subject) => (
                    <div
                      key={subject._id}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedSubject?._id === subject._id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                      onClick={() => {
                        setSelectedSubject(subject);
                        setSelectedQuiz(null);
                        setQuestionBank(null);
                        setActiveTab('quizzes');
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-semibold flex items-center gap-2">
                            {subject.name}
                            {subject.code && <Badge variant="outline" className="text-xs">{subject.code}</Badge>}
                          </h3>
                          <p className="text-sm text-gray-500">
                            {subject.totalPapers || 0} papers 
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSubject(subject._id, subject.name);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          {!selectedSubject ? (
            <Card>
              <CardContent className="py-16 text-center">
                <FolderOpen className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-semibold text-gray-500">Select a Subject</h2>
                <p className="text-gray-400 mt-2">Choose a subject to manage its quizzes</p>
              </CardContent>
            </Card>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="quizzes" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Quizzes
                </TabsTrigger>
                <TabsTrigger value="questionbank" className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Question Bank
                  {questionBank && questionBank.totalQuestions > 0 && (
                    <Badge className="ml-1 bg-indigo-500 text-white text-xs">{questionBank.totalQuestions}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="analytics" className="flex items-center gap-2" disabled={results.length === 0}>
                  <BarChart3 className="h-4 w-4" />
                  Analytics
                  {results.length > 0 && (
                    <Badge className="ml-1 bg-green-500 text-white text-xs">{results.length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Quizzes Tab */}
              <TabsContent value="quizzes">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  {/* Quiz List */}
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        {selectedSubject.name} Quizzes
                      </CardTitle>
                      <Dialog open={isQuizDialogOpen} onOpenChange={setIsQuizDialogOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                            <Plus className="h-4 w-4 mr-1" />
                            Add Quiz
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create New Quiz</DialogTitle>
                            <DialogDescription>Add a quiz to {selectedSubject.name}</DialogDescription>
                          </DialogHeader>
                          <div className="py-4">
                            <Label htmlFor="quiz-name">Quiz Name</Label>
                            <Input
                              id="quiz-name"
                              placeholder={`Quiz ${quizzes.length + 1}`}
                              value={newQuizName}
                              onChange={(e) => setNewQuizName(e.target.value)}
                            />
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsQuizDialogOpen(false)}>Cancel</Button>
                            <Button onClick={handleCreateQuiz} disabled={isProcessing}>
                              {isProcessing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                              Create Quiz
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </CardHeader>
                    <CardContent>
                      {quizzes.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No quizzes yet</p>
                      ) : (
                        <div className="space-y-2">
                          {quizzes.map((quiz) => (
                            <div
                              key={quiz._id}
                              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                                selectedQuiz?._id === quiz._id
                                  ? 'border-indigo-500 bg-indigo-50'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                              onClick={() => setSelectedQuiz(quiz)}
                            >
                              <div className="flex justify-between items-center">
                                <div>
                                  <h4 className="font-semibold">{quiz.paperName}</h4>
                                  <div className="flex gap-2 mt-1">
                                    {quiz.key?.uploadedAt ? (
                                      <Badge className="bg-green-100 text-green-700 text-xs">
                                        <Key className="h-3 w-3 mr-1" />
                                        {quiz.key?.questions?.length || 0} Q
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-yellow-100 text-yellow-700 text-xs">
                                        <AlertCircle className="h-3 w-3 mr-1" />
                                        No Key
                                      </Badge>
                                    )}
                                    <Badge variant="outline" className="text-xs">
                                      <Users className="h-3 w-3 mr-1" />
                                      {quiz.studentResponses?.length || 0} attempts
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                      {quiz.totalMarks} marks
                                    </Badge>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <ChevronRight className="h-4 w-4 text-gray-400" />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-500 hover:text-red-700"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteQuiz(quiz._id, quiz.paperName);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Quiz Details & Upload */}
                  {selectedQuiz && (
                    <Card>
                      <CardHeader>
                        <CardTitle>{selectedQuiz.paperName}</CardTitle>
                        <CardDescription>Upload key and student responses</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* OCR Provider Selection */}
                        <div className="p-4 border rounded-lg bg-gray-50 border-gray-200">
                          <h4 className="font-semibold flex items-center gap-2 mb-3">
                            <Sparkles className="h-4 w-4" />
                            OCR Provider
                          </h4>
                          <RadioGroup
                            value={ocrProvider}
                            onValueChange={(value) => setOcrProvider(value as 'groq' | 'landing' | 'gemini')}
                            className="flex flex-col sm:flex-row gap-3 flex-wrap"
                          >
                            <div className={`flex items-center space-x-2 p-3 rounded-lg border-2 cursor-pointer transition-all flex-1 ${
                              ocrProvider === 'groq' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                            }`}>
                              <RadioGroupItem value="groq" id="ocr-groq" />
                              <Label htmlFor="ocr-groq" className="cursor-pointer flex-1">
                                <div className="flex items-center gap-2">
                                  <Zap className="h-4 w-4 text-green-600" />
                                  <span className="font-semibold">Groq Vision</span>
                                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Free</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">~80 PDFs/day free</p>
                              </Label>
                            </div>
                            <div className={`flex items-center space-x-2 p-3 rounded-lg border-2 cursor-pointer transition-all flex-1 ${
                              ocrProvider === 'landing' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                            }`}>
                              <RadioGroupItem value="landing" id="ocr-landing" />
                              <Label htmlFor="ocr-landing" className="cursor-pointer flex-1">
                                <div className="flex items-center gap-2">
                                  <Zap className="h-4 w-4 text-blue-600" />
                                  <span className="font-semibold">Landing AI</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Premium (Paid)</p>
                              </Label>
                            </div>
                            <div className={`flex items-center space-x-2 p-3 rounded-lg border-2 cursor-pointer transition-all flex-1 ${
                              ocrProvider === 'gemini' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
                            }`}>
                              <RadioGroupItem value="gemini" id="ocr-gemini" />
                              <Label htmlFor="ocr-gemini" className="cursor-pointer flex-1">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-purple-600" />
                                  <span className="font-semibold">Google Gemini</span>
                                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Best Handwriting</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Free (1500/day)</p>
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>

                        {/* Upload Answer Key */}
                        <div className="p-4 border rounded-lg bg-yellow-50 border-yellow-200">
                          <h4 className="font-semibold flex items-center gap-2 mb-3">
                            <Key className="h-4 w-4" />
                            Answer Key
                          </h4>
                          {selectedQuiz.key?.uploadedAt ? (
                            <div className="text-sm text-green-700">
                              <CheckCircle className="h-4 w-4 inline mr-1" />
                              Key uploaded ({selectedQuiz.key?.questions?.length || 0} questions, {selectedQuiz.totalMarks} marks)
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <Input
                                ref={keyFileRef}
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={(e) => setKeyFile(e.target.files?.[0] || null)}
                              />
                              <Button
                                onClick={handleKeyUpload}
                                disabled={!keyFile || isProcessing}
                                className="w-full"
                              >
                                {isProcessing ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                  <UploadIcon className="h-4 w-4 mr-2" />
                                )}
                                Upload Answer Key
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* Upload Student Responses */}
                        <div className="p-4 border rounded-lg bg-blue-50 border-blue-200">
                          <h4 className="font-semibold flex items-center gap-2 mb-3">
                            <Users className="h-4 w-4" />
                            Student Responses ({selectedQuiz.studentResponses?.length || 0})
                          </h4>
                          <div className="space-y-3">
                            <Label className="text-sm text-gray-600">Select student response files</Label>
                            <div className="flex items-center gap-2">
                              <input
                                ref={studentFileRef}
                                type="file"
                                multiple
                                accept=".pdf,.jpg,.jpeg,.png"
                                // @ts-ignore - webkitdirectory is valid HTML attribute
                                webkitdirectory=""
                                onChange={(e) => {
                                  const files = Array.from(e.target.files || []);
                                  const validFiles = files.filter(f => /\.(pdf|jpg|jpeg|png)$/i.test(f.name));
                                  setStudentFiles(validFiles);
                                }}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              />
                              <Button variant="outline" size="icon" onClick={() => studentFileRef.current?.click()}>
                                <FolderOpen className="h-4 w-4" />
                              </Button>
                            </div>
                            {studentFiles.length > 0 && (
                              <div className="text-sm text-gray-600 bg-white p-2 rounded border">
                                <span className="font-medium">{studentFiles.length} file(s)</span> selected
                              </div>
                            )}
                            <Button
                              onClick={handleStudentUpload}
                              disabled={studentFiles.length === 0 || isProcessing}
                              className="w-full"
                              variant="outline"
                            >
                              {isProcessing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                <UploadIcon className="h-4 w-4 mr-2" />
                              )}
                              Upload Responses
                            </Button>
                          </div>
                        </div>

                        {/* Evaluate Button */}
                        {selectedQuiz.key?.questions?.length > 0 && (selectedQuiz.studentResponses?.length || 0) > 0 && (
                          <Button
                            onClick={handleEvaluate}
                            disabled={isEvaluating}
                            className="w-full bg-green-600 hover:bg-green-700"
                          >
                            {isEvaluating ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Play className="h-4 w-4 mr-2" />
                            )}
                            Evaluate All Students
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* Question Bank Tab */}
              <TabsContent value="questionbank">
                {isLoadingQuestionBank ? (
                  <div className="flex justify-center items-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                  </div>
                ) : questionBank && questionBank.questions.length > 0 ? (
                  <div className="space-y-6">
                    {/* Question Bank Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card className="bg-indigo-50 border-indigo-200">
                        <CardContent className="p-4 text-center">
                          <Database className="h-8 w-8 mx-auto mb-2 text-indigo-600" />
                          <p className="text-2xl font-bold text-indigo-700">{questionBank.totalQuestions}</p>
                          <p className="text-sm text-indigo-600">Total Questions</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-green-50 border-green-200">
                        <CardContent className="p-4 text-center">
                          <HelpCircle className="h-8 w-8 mx-auto mb-2 text-green-600" />
                          <p className="text-2xl font-bold text-green-700">
                            {questionBank.questions.filter(q => q.questionType === 'MCQ').length}
                          </p>
                          <p className="text-sm text-green-600">MCQ</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-blue-50 border-blue-200">
                        <CardContent className="p-4 text-center">
                          <FileText className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                          <p className="text-2xl font-bold text-blue-700">
                            {questionBank.questions.filter(q => q.questionType === 'SHORT' || q.questionType === 'LONG').length}
                          </p>
                          <p className="text-sm text-blue-600">Descriptive</p>
                        </CardContent>
                      </Card>
                      <Card className="bg-purple-50 border-purple-200">
                        <CardContent className="p-4 text-center">
                          <TrendingUp className="h-8 w-8 mx-auto mb-2 text-purple-600" />
                          <p className="text-2xl font-bold text-purple-700">
                            {Math.max(...questionBank.questions.map(q => q.frequency))}
                          </p>
                          <p className="text-sm text-purple-600">Max Frequency</p>
                        </CardContent>
                      </Card>
                        {/* <Card className="bg-blue-50 border-blue-200">
                        <CardContent className="p-4 text-center">
                          <FileText className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                          <p className="text-2xl font-bold text-blue-700">
                            {questionBank.questions.filter(q => q.questionType === 'FILL_BLANK' || q.questionType === 'TRUE_FALSE').length}
                          </p>
                          <p className="text-sm text-blue-600">True/False and Fill in the Blanks</p>
                        </CardContent>
                      </Card> */}
                    </div>

                    {/* Search and Filter */}
                    <Card>
                      <CardContent className="p-4">
                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                              placeholder="Search questions..."
                              value={questionBankSearch}
                              onChange={(e) => setQuestionBankSearch(e.target.value)}
                              className="pl-10"
                            />
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            {/* Type Filters */}
                            <Button
                              variant={questionBankFilter === 'all' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setQuestionBankFilter('all')}
                            >
                              All
                            </Button>
                            <Button
                              variant={questionBankFilter === 'MCQ' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setQuestionBankFilter('MCQ')}
                            >
                              MCQ
                            </Button>
                            <Button
                              variant={questionBankFilter === 'SHORT' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setQuestionBankFilter('SHORT')}
                            >
                              Short
                            </Button>
                            <Button
                              variant={questionBankFilter === 'LONG' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setQuestionBankFilter('LONG')}
                            >
                              Long
                            </Button>
                            

                            {/* Divider */}
                            <div className="border-l border-gray-300 mx-1"></div>

                            {/* Difficulty Filters (from Analytics) */}
                            <Button
                              variant={questionBankDifficultyFilter === 'all' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setQuestionBankDifficultyFilter('all')}
                            >
                              All Difficulty
                            </Button>
                            <Button
                              variant={questionBankDifficultyFilter === 'Easy' ? 'default' : 'outline'}
                              size="sm"
                              className={questionBankDifficultyFilter === 'Easy' ? 'bg-green-600 hover:bg-green-700' : 'text-green-600 border-green-300 hover:bg-green-50'}
                              onClick={() => setQuestionBankDifficultyFilter('Easy')}
                            >
                              Easy ({difficultyCounts.Easy})
                            </Button>
                            <Button
                              variant={questionBankDifficultyFilter === 'Medium' ? 'default' : 'outline'}
                              size="sm"
                              className={questionBankDifficultyFilter === 'Medium' ? 'bg-yellow-600 hover:bg-yellow-700' : 'text-yellow-600 border-yellow-300 hover:bg-yellow-50'}
                              onClick={() => setQuestionBankDifficultyFilter('Medium')}
                            >
                              Medium ({difficultyCounts.Medium})
                            </Button>
                            <Button
                              variant={questionBankDifficultyFilter === 'Hard' ? 'default' : 'outline'}
                              size="sm"
                              className={questionBankDifficultyFilter === 'Hard' ? 'bg-red-600 hover:bg-red-700' : 'text-red-600 border-red-300 hover:bg-red-50'}
                              onClick={() => setQuestionBankDifficultyFilter('Hard')}
                            >
                              Hard ({difficultyCounts.Hard})
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Questions List */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Database className="h-5 w-5" />
                          Questions ({questionBank.questions.filter(q => {
                            const matchesSearch = questionBankSearch === '' ||
                              q.questionText.toLowerCase().includes(questionBankSearch.toLowerCase());
                            const matchesFilter = questionBankFilter === 'all' || q.questionType === questionBankFilter;
                            const matchesDifficulty = questionBankDifficultyFilter === 'all' ||
                              getQuestionDifficulty(q) === questionBankDifficultyFilter;
                            return matchesSearch && matchesFilter && matchesDifficulty;
                          }).length})
                        </CardTitle>
                        <CardDescription>
                          All unique questions from {selectedSubject?.name}
                          {questionAnalysis.length === 0 && (
                            <span className="text-yellow-600 ml-2">(Evaluate quiz for difficulty data)</span>
                          )}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3 max-h-[500px] overflow-y-auto">
                          {questionBank.questions
                            .filter(q => {
                              const matchesSearch = questionBankSearch === '' ||
                                q.questionText.toLowerCase().includes(questionBankSearch.toLowerCase());
                              const matchesFilter = questionBankFilter === 'all' || q.questionType === questionBankFilter;
                              const matchesDifficulty = questionBankDifficultyFilter === 'all' ||
                                getQuestionDifficulty(q) === questionBankDifficultyFilter;
                              return matchesSearch && matchesFilter && matchesDifficulty;
                            })
                            .map((question, idx) => (
                              <div
                                key={question._id || idx}
                                className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex justify-between items-start gap-4">
                                  <div className="flex-1">
                                    <p className="font-medium text-gray-800 mb-2">
                                      <span className="text-indigo-600 mr-2">Q{idx + 1}.</span>
                                      {question.questionText}
                                    </p>
                                    {question.options && question.options.length > 0 && (
                                      <div className="ml-6 space-y-1 mb-2">
                                        {question.options.map((opt, optIdx) => (
                                          <p key={optIdx} className={`text-sm ${
                                            question.answer === opt ? 'text-green-600 font-medium' : 'text-gray-600'
                                          }`}>
                                            {String.fromCharCode(65 + optIdx)}. {opt}
                                            {question.answer === opt && ' ✓'}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                    {question.answer && (
                                      <div className="ml-6 mt-2 p-2 bg-green-50 border border-green-200 rounded">
                                        <p className="text-sm text-green-700">
                                          <span className="font-semibold">Answer:</span> {question.answer}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-2 items-end">
                                    {/* Delete Button */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-red-500 hover:text-red-700 hover:bg-red-50 h-7 w-7 p-0"
                                      onClick={() => handleDeleteQuestion(question._id)}
                                      title="Delete question"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                    {/* Difficulty Badge from MongoDB */}
                                    {(() => {
                                      const difficulty = getQuestionDifficulty(question);
                                      return (
                                        <Badge className={`text-xs ${getDifficultyColorClass(difficulty)}`}>
                                          {difficulty}
                                        </Badge>
                                      );
                                    })()}
                                    <Badge variant="outline" className="text-xs">
                                      {question.questionType || 'MCQ'}
                                    </Badge>
                                    <Badge className="bg-indigo-100 text-indigo-700 text-xs">
                                      <Hash className="h-3 w-3 mr-1" />
                                      {question.frequency}x
                                    </Badge>
                                    <Badge variant="outline" className="text-xs">
                                      {question.marks} mark{question.marks !== 1 ? 's' : ''}
                                    </Badge>
                                  </div>
                                </div>
                                {question.sourceFiles && question.sourceFiles.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {question.sourceFiles.map((file, fileIdx) => (
                                      <Badge key={fileIdx} variant="secondary" className="text-xs">
                                        {file}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-16 text-center">
                      <Database className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                      <h2 className="text-xl font-semibold text-gray-500">No Questions Yet</h2>
                      <p className="text-gray-400 mt-2">
                        Questions will be added automatically when you upload answer keys
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Analytics Tab */}
              <TabsContent value="analytics">
                {results.length > 0 ? (
                  <div className="space-y-6">
                    {/* Header Card with Stats */}
                    <Card>
                      <CardHeader>
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <BarChart3 className="h-5 w-5" />
                              Results & Analytics
                            </CardTitle>
                            <CardDescription className="mt-1">
                              {currentAnalytics?.paperName} - {currentAnalytics?.subjectName}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {/* Stats Summary */}
                        {analytics && (
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                            <div className="p-4 bg-blue-50 rounded-lg text-center border border-blue-200">
                              <Users className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                              <p className="text-2xl font-bold text-blue-700">{results.length}</p>
                              <p className="text-xs text-blue-600">Students</p>
                            </div>
                            <div className="p-4 bg-indigo-50 rounded-lg text-center border border-indigo-200">
                              <TrendingUp className="h-5 w-5 mx-auto mb-1 text-indigo-600" />
                              <p className="text-2xl font-bold text-indigo-700">{analytics.averageScore}%</p>
                              <p className="text-xs text-indigo-600">Class Average</p>
                            </div>
                            <div className="p-4 bg-green-50 rounded-lg text-center border border-green-200">
                              <Target className="h-5 w-5 mx-auto mb-1 text-green-600" />
                              <p className="text-2xl font-bold text-green-700">{analytics.highestScore}%</p>
                              <p className="text-xs text-green-600">Highest</p>
                            </div>
                            <div className="p-4 bg-red-50 rounded-lg text-center border border-red-200">
                              <Target className="h-5 w-5 mx-auto mb-1 text-red-600" />
                              <p className="text-2xl font-bold text-red-700">{analytics.lowestScore}%</p>
                              <p className="text-xs text-red-600">Lowest</p>
                            </div>
                            <div className="p-4 bg-purple-50 rounded-lg text-center border border-purple-200">
                              <CheckCircle className="h-5 w-5 mx-auto mb-1 text-purple-600" />
                              <p className="text-2xl font-bold text-purple-700">{analytics.passRate}%</p>
                              <p className="text-xs text-purple-600">Pass Rate</p>
                            </div>
                            <div className="p-4 bg-orange-50 rounded-lg text-center border border-orange-200">
                              <HelpCircle className="h-5 w-5 mx-auto mb-1 text-orange-600" />
                              <p className="text-2xl font-bold text-orange-700">{selectedQuiz?.key?.questions?.length || 0}</p>
                              <p className="text-xs text-orange-600">Questions</p>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Charts Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Bar Graph - Question-wise Performance */}
                      <Card className="shadow-lg">
                        <CardHeader>
                          <CardTitle className="text-lg">Question-wise Performance</CardTitle>
                          <CardDescription>
                            How many students got each question correct
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="h-[400px]">
                            <AnalysisBarGraph data={questionAnalysis.map((q) => ({
                              questionNumber: q.questionNumber,
                              correctCount: q.correctCount,
                              accuracy: q.accuracy
                            }))} />
                          </div>
                        </CardContent>
                      </Card>

                      {/* Pie Chart - Difficulty Distribution */}
                      <Card className="shadow-lg">
                        <CardHeader>
                          <CardTitle className="text-lg">Difficulty Distribution</CardTitle>
                          <CardDescription>
                            Questions categorized by difficulty based on class mean ({classMeanAccuracy.toFixed(1)}%)
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="h-[400px]">
                            <AnalysisPieChart data={questionAnalysis.map(q => ({
                              difficultyLevel: q.difficulty
                            }))} />
                          </div>

                          {/* Class Mean Info */}
                          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-center">
                            <p className="text-sm text-gray-600">
                              <strong>Class Mean:</strong> {classMeanAccuracy.toFixed(1)}% |
                              <strong className="ml-2">Std Dev:</strong> {classStdDev.toFixed(1)}%
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              Easy = above mean | Medium = around mean | Hard = below mean
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Question Analysis Table */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Question-wise Analysis</CardTitle>
                        <CardDescription>
                          Performance breakdown for each question. Difficulty is based on class mean ({classMeanAccuracy.toFixed(1)}%):
                          Easy = above average, Medium = around average, Hard = below average
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto border rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Q No.</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Question</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Attempts</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-green-600 uppercase">Correct</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-yellow-600 uppercase">Partial</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-red-600 uppercase">Wrong</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Difficulty</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {questionAnalysis.map((q) => (
                                <tr key={q.questionNumber} className="hover:bg-gray-50">
                                  <td className="px-3 py-3 text-sm font-semibold">Q{q.questionNumber}</td>
                                  <td className="px-3 py-3 text-sm max-w-xs truncate" title={q.questionText}>
                                    {q.questionText}
                                  </td>
                                  <td className="px-3 py-3 text-sm text-center">{q.totalAttempts}</td>
                                  <td className="px-3 py-3 text-sm text-center font-medium text-green-600">{q.correctCount}</td>
                                  <td className="px-3 py-3 text-sm text-center font-medium text-yellow-600">{q.partialCount}</td>
                                  <td className="px-3 py-3 text-sm text-center font-medium text-red-600">{q.wrongCount}</td>
                                  <td className="px-3 py-3 text-sm text-center font-medium">{q.accuracy.toFixed(1)}%</td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getDifficultyColorClass(q.difficulty)}`}>
                                      {q.difficulty}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Student Results Table */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Student Results</CardTitle>
                        <CardDescription>
                          Individual student performance ranked by score (with correct/partial/wrong breakdown)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto border rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-green-600 uppercase">Correct</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-yellow-600 uppercase">Partial</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-red-600 uppercase">Wrong</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marks</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">%</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Grade</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {results.slice(0, visibleResultsCount).map((result, rank) => {
                                // Use summary from MongoDB if available, otherwise calculate
                                const correctCount = result.summary?.fullCorrect ?? 0;
                                const partialCount = result.summary?.partialCorrect ?? 0;
                                const wrongCount = result.summary?.wrong ?? 0;

                                return (
                                <React.Fragment key={result.enrollmentNumber + rank}>
                                  <tr className={rank < 3 ? 'bg-yellow-50' : ''}>
                                    <td className="px-3 py-3 text-sm">
                                      {rank === 0 && <span className="text-yellow-500 font-bold">🥇</span>}
                                      {rank === 1 && <span className="text-gray-400 font-bold">🥈</span>}
                                      {rank === 2 && <span className="text-orange-400 font-bold">🥉</span>}
                                      {rank > 2 && <span>{rank + 1}</span>}
                                    </td>
                                    <td className="px-3 py-3 text-sm font-medium">{result.enrollmentNumber}</td>
                                    <td className="px-3 py-3 text-sm text-center font-medium text-green-600">{correctCount}</td>
                                    <td className="px-3 py-3 text-sm text-center font-medium text-yellow-600">{partialCount}</td>
                                    <td className="px-3 py-3 text-sm text-center font-medium text-red-600">{wrongCount}</td>
                                    <td className="px-3 py-3 text-sm">{result.obtainedMarks}/{selectedQuiz?.totalMarks}</td>
                                    <td className="px-3 py-3 text-sm font-bold">{result.percentage}%</td>
                                    <td className="px-3 py-3">
                                      <Badge className={
                                        result.grade === 'A+' ? 'bg-emerald-100 text-emerald-700' :
                                        result.grade === 'A' ? 'bg-green-100 text-green-700' :
                                        result.grade === 'B+' ? 'bg-blue-100 text-blue-700' :
                                        result.grade === 'B' ? 'bg-cyan-100 text-cyan-700' :
                                        result.grade === 'C' ? 'bg-yellow-100 text-yellow-700' :
                                        result.grade === 'D' ? 'bg-orange-100 text-orange-700' :
                                        'bg-red-100 text-red-700'
                                      }>
                                        {result.grade}
                                      </Badge>
                                    </td>
                                    <td className="px-3 py-3">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setExpandedResult(
                                          expandedResult === rank ? null : rank
                                        )}
                                      >
                                        {expandedResult === rank ? (
                                          <EyeOff className="h-4 w-4" />
                                        ) : (
                                          <Eye className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => handleDeleteStudentResult(result._id, result.enrollmentNumber)}
                                        title="Delete student result"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </td>
                                  </tr>
                                  {expandedResult === rank && (
                                    <tr>
                                      <td colSpan={10} className="p-0 bg-gray-50">
                                        <div className="p-4">
                                          <h4 className="text-sm font-semibold mb-3">
                                            Question-wise Details for {result.enrollmentNumber}
                                          </h4>

                                          {(result.questionStats || result.answers) && (result.questionStats || result.answers).length > 0 ? (
                                            <div className="overflow-x-auto border rounded-lg bg-white">
                                              <table className="min-w-full divide-y divide-gray-200 text-sm">
                                                <thead className="bg-gray-100">
                                                  <tr>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Q No.</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Question</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Correct Answer</th>
                                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Student Answer</th>
                                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Marks</th>
                                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Obtained</th>
                                                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200">
                                                  {(result.questionStats || result.answers || []).map((ans: any, idx: number) => {
                                                    // Get question details from quiz key if available
                                                    const quizQuestion = selectedQuiz?.key?.questions?.[idx] || {};
                                                    const qNum = ans.questionNumber || idx + 1;
                                                    const qText = ans.questionText || quizQuestion.questionText || `Question ${qNum}`;
                                                    const correctAns = ans.correctAnswer || quizQuestion.correctAnswer || quizQuestion.answer || '-';
                                                    const studentAns = ans.studentAnswer || ans.selected || '-';
                                                    const maxMarks = ans.marks || ans.maxMarks || quizQuestion.marks || 1;
                                                    const obtained = ans.obtained ?? ans.marksObtained ?? 0;
                                                    // Check for full marks first (isFullMarks flag or obtained equals max)
                                                    const isFullCorrect = ans.isFullMarks || obtained === maxMarks;
                                                    // Partial: got some marks but not full marks
                                                    const isPartial = ans.isPartial || (!isFullCorrect && obtained > 0);
                                                    // For display purposes, isCorrect means full marks
                                                    const isCorrect = isFullCorrect;

                                                    return (
                                                      <tr
                                                        key={idx}
                                                        className={
                                                          isCorrect ? 'bg-green-50/50' :
                                                          isPartial ? 'bg-yellow-50/50' : 'bg-red-50/50'
                                                        }
                                                      >
                                                        <td className="px-3 py-2 font-semibold">{qNum}</td>
                                                        <td className="px-3 py-2 max-w-xs truncate" title={qText}>
                                                          {qText}
                                                        </td>
                                                        <td className="px-3 py-2 text-green-700 font-medium">{correctAns}</td>
                                                        <td className="px-3 py-2 text-gray-700">{studentAns}</td>
                                                        <td className="px-3 py-2 text-center">{maxMarks}</td>
                                                        <td className="px-3 py-2 text-center font-bold">{obtained}</td>
                                                        <td className="px-3 py-2 text-center">
                                                          {isCorrect ? (
                                                            <div className="flex items-center justify-center gap-1">
                                                              <CheckCircle className="h-5 w-5 text-green-600" />
                                                              <span className="text-green-600 text-xs">Full</span>
                                                            </div>
                                                          ) : isPartial ? (
                                                            <div className="flex items-center justify-center gap-1">
                                                              <span className="text-yellow-600 font-medium">Partial</span>
                                                              <span className="text-yellow-500 text-xs">({obtained}/{maxMarks})</span>
                                                            </div>
                                                          ) : (
                                                            <div className="flex items-center justify-center gap-1">
                                                              <XCircle className="h-5 w-5 text-red-600" />
                                                              <span className="text-red-600 text-xs">Wrong</span>
                                                            </div>
                                                          )}
                                                        </td>
                                                      </tr>
                                                    );
                                                  })}
                                                </tbody>
                                              </table>
                                            </div>
                                          ) : (
                                            <div className="text-center py-4 text-gray-500">
                                              No detailed answer data available for this student.
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Buttons */}
                        {results.length > 5 && (
                          <div className="flex justify-center gap-4 mt-4">
                            <p className="text-sm text-gray-500 self-center">
                              Showing {Math.min(visibleResultsCount, results.length)} of {results.length} students
                            </p>
                            {visibleResultsCount < results.length && (
                              <Button
                                variant="outline"
                                onClick={() => setVisibleResultsCount(prev => Math.min(prev + 5, results.length))}
                              >
                                Load More
                              </Button>
                            )}
                            {visibleResultsCount < results.length && (
                              <Button
                                variant="default"
                                className="bg-indigo-600 hover:bg-indigo-700"
                                onClick={() => setVisibleResultsCount(results.length)}
                              >
                                Show All ({results.length})
                              </Button>
                            )}
                            {visibleResultsCount > 5 && (
                              <Button
                                variant="outline"
                                onClick={() => setVisibleResultsCount(5)}
                              >
                                Show Less
                              </Button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="py-16 text-center">
                      <BarChart3 className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                      <h2 className="text-xl font-semibold text-gray-500">No Results Yet</h2>
                      <p className="text-gray-400 mt-2">
                        Upload answer key and student responses, then evaluate
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubjectManager;
