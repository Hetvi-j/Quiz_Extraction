import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Edit3,
  Save,
  RefreshCw,
  AlertCircle,
  Search,
  FileText,
  Users,
  ChevronDown,
  ChevronRight,
  Eye,
  PenLine,
  ClipboardCheck
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:8080/api/free-ocr';

interface QuestionStat {
  questionNumber: number;
  questionText: string;
  questionType: string;
  correctAnswer: string;
  studentAnswer: string;
  marks: number;
  obtained: number;
  feedback?: string;
  manuallyOverridden?: boolean;
  originalObtained?: number;
  overrideReason?: string;
}

interface EvaluationResult {
  _id: string;
  enrollmentNumber: string;
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string;
  questionStats: QuestionStat[];
  hasOverrides: boolean;
  evaluatedAt?: string;
}

interface StudentExtraction {
  enrollmentNumber: string;
  fileName: string;
  questionCount: number;
  answeredCount: number;
  submittedAt?: string;
}

interface ExtractedQuestion {
  questionNumber: number;
  questionText?: string;
  answer: string;
}

interface Paper {
  _id: string;
  paperName: string;
}

const EvaluationReview = () => {
  // Active tab
  const [activeTab, setActiveTab] = useState<'pre-evaluation' | 'post-evaluation'>('post-evaluation');

  // Paper selection
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState<string>('');
  const [paperDetails, setPaperDetails] = useState<any>(null);

  // Post-evaluation: Results state
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [filteredResults, setFilteredResults] = useState<EvaluationResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

  // Pre-evaluation: Extraction state
  const [students, setStudents] = useState<StudentExtraction[]>([]);
  const [selectedStudentEnrollment, setSelectedStudentEnrollment] = useState<string>('');
  const [studentQuestions, setStudentQuestions] = useState<ExtractedQuestion[]>([]);
  const [answerKey, setAnswerKey] = useState<any[]>([]);

  // Loading and status
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{ type: string; message: string }>({ type: '', message: '' });

  // Override dialog state (post-evaluation)
  const [overrideDialog, setOverrideDialog] = useState(false);
  const [currentOverride, setCurrentOverride] = useState<{
    enrollmentNumber: string;
    question: QuestionStat;
  } | null>(null);
  const [newMarks, setNewMarks] = useState('');
  const [overrideFeedback, setOverrideFeedback] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Correction dialog state (pre-evaluation)
  const [correctionDialog, setCorrectionDialog] = useState(false);
  const [currentCorrection, setCurrentCorrection] = useState<{
    questionNumber: number;
    originalAnswer: string;
    keyAnswer?: string;
  } | null>(null);
  const [newAnswer, setNewAnswer] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Fetch papers on mount
  useEffect(() => {
    fetchPapers();
  }, []);

  // Filter results based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredResults(results);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredResults(results.filter(r =>
        r.enrollmentNumber.toLowerCase().includes(query) ||
        r.grade.toLowerCase().includes(query)
      ));
    }
  }, [searchQuery, results]);

  const fetchPapers = async () => {
    try {
      const response = await fetch('http://localhost:8080/api/v1/paper');
      if (response.ok) {
        const data = await response.json();
        setPapers(data.papers || data || []);
      }
    } catch (error) {
      console.error('Error fetching papers:', error);
    }
  };

  // ==================== POST-EVALUATION FUNCTIONS ====================

  const fetchResults = async () => {
    if (!selectedPaperId) {
      setStatus({ type: 'error', message: 'Please select a paper first' });
      return;
    }

    setIsLoading(true);
    setStatus({ type: 'info', message: 'Loading evaluation results...' });

    try {
      const response = await fetch(`${API_BASE_URL}/paper/${selectedPaperId}/results`);
      const data = await response.json();

      if (data.success) {
        setResults(data.results);
        setFilteredResults(data.results);
        setPaperDetails({
          paperName: data.paperName,
          subjectName: data.subjectName,
          totalMarks: data.totalMarks,
          answerKey: data.answerKey
        });
        setStatus({
          type: 'success',
          message: `Loaded ${data.totalResults} student results`
        });
      } else {
        throw new Error(data.message || 'Failed to fetch results');
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const openOverrideDialog = (enrollmentNumber: string, question: QuestionStat) => {
    setCurrentOverride({ enrollmentNumber, question });
    setNewMarks(question.obtained.toString());
    setOverrideFeedback(question.feedback || '');
    setOverrideReason('');
    setOverrideDialog(true);
  };

  const handleOverride = async () => {
    if (!currentOverride || !selectedPaperId) return;

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/paper/${selectedPaperId}/results/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentNumber: currentOverride.enrollmentNumber,
          questionNumber: currentOverride.question.questionNumber,
          newMarks: parseFloat(newMarks),
          feedback: overrideFeedback,
          overrideReason: overrideReason || 'Manual correction'
        })
      });

      const data = await response.json();

      if (data.success) {
        setStatus({ type: 'success', message: data.message });
        await fetchResults();
        setOverrideDialog(false);
      } else {
        throw new Error(data.message);
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== PRE-EVALUATION FUNCTIONS ====================

  const fetchExtractions = async () => {
    if (!selectedPaperId) {
      setStatus({ type: 'error', message: 'Please select a paper first' });
      return;
    }

    setIsLoading(true);
    setStatus({ type: 'info', message: 'Loading extracted answers...' });

    try {
      const response = await fetch(`${API_BASE_URL}/paper/${selectedPaperId}/corrections`);
      const data = await response.json();

      if (data.success) {
        setStudents(data.students || []);
        setAnswerKey(data.answerKey || []);
        setPaperDetails({
          paperName: data.paperName,
          subjectName: data.subjectName,
          totalMarks: data.totalMarks
        });
        setStatus({
          type: 'success',
          message: `Loaded ${data.totalStudents} students`
        });
      } else {
        throw new Error(data.message);
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
      setStudents([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStudentDetails = async (enrollmentNumber: string) => {
    if (!selectedPaperId) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/paper/${selectedPaperId}/corrections?enrollmentNumber=${enrollmentNumber}`
      );
      const data = await response.json();

      if (data.success) {
        setStudentQuestions(data.studentResponse?.questions || []);
        setSelectedStudentEnrollment(enrollmentNumber);
      } else {
        throw new Error(data.message);
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const openCorrectionDialog = (question: ExtractedQuestion) => {
    const keyQ = answerKey.find(k => k.questionNumber === question.questionNumber);
    setCurrentCorrection({
      questionNumber: question.questionNumber,
      originalAnswer: question.answer,
      keyAnswer: keyQ?.answer
    });
    setNewAnswer(question.answer || '');
    setCorrectionDialog(true);
  };

  const handleCorrection = async () => {
    if (!currentCorrection || !selectedPaperId || !selectedStudentEnrollment) return;

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/paper/${selectedPaperId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentNumber: selectedStudentEnrollment,
          corrections: [{
            questionNumber: currentCorrection.questionNumber,
            newAnswer: newAnswer
          }]
        })
      });

      const data = await response.json();

      if (data.success) {
        setStatus({ type: 'success', message: 'Correction saved successfully' });
        // Refresh student details
        await fetchStudentDetails(selectedStudentEnrollment);
        setCorrectionDialog(false);
      } else {
        throw new Error(data.message);
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== HELPER FUNCTIONS ====================

  const toggleStudent = (enrollmentNumber: string) => {
    setExpandedStudent(expandedStudent === enrollmentNumber ? null : enrollmentNumber);
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+': return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'A': return 'bg-green-100 text-green-800 border-green-300';
      case 'B+': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'B': return 'bg-cyan-100 text-cyan-800 border-cyan-300';
      case 'C': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'D': return 'bg-orange-100 text-orange-800 border-orange-300';
      default: return 'bg-red-100 text-red-800 border-red-300';
    }
  };

  const getQuestionTypeColor = (type: string) => {
    switch (type?.toUpperCase()) {
      case 'MCQ': return 'bg-purple-100 text-purple-800';
      case 'SHORT': return 'bg-blue-100 text-blue-800';
      case 'LONG': return 'bg-indigo-100 text-indigo-800';
      case 'TRUE_FALSE': return 'bg-cyan-100 text-cyan-800';
      case 'FILL_BLANK': return 'bg-teal-100 text-teal-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const censorEnrollment = (num: string) => {
    if (!num || num.length <= 5) return num;
    return num.substring(0, num.length - 5) + '*****';
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      {/* Header */}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Manual Correction & Evaluation Review
          </CardTitle>
          <CardDescription>
            Correct OCR extraction errors before evaluation, or override LLM grades after evaluation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Paper Selection */}
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Select Paper</label>
              <Select value={selectedPaperId} onValueChange={(v) => {
                setSelectedPaperId(v);
                setResults([]);
                setStudents([]);
                setSelectedStudentEnrollment('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a paper" />
                </SelectTrigger>
                <SelectContent>
                  {papers.map((paper: any) => (
                    <SelectItem key={paper._id} value={paper._id}>
                      {paper.paperName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          {status.message && (
            <Alert className={
              status.type === 'success' ? 'bg-green-50 border-green-200' :
                status.type === 'error' ? 'bg-red-50 border-red-200' :
                  'bg-blue-50 border-blue-200'
            }>
              <div className="flex items-center gap-2">
                {status.type === 'success' && <CheckCircle className="h-4 w-4 text-green-600" />}
                {status.type === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                {status.type === 'info' && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
                <AlertDescription>{status.message}</AlertDescription>
              </div>
            </Alert>
          )}

          {/* Paper Details */}
          {paperDetails && (
            <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="text-sm text-gray-500">Paper</p>
                <p className="font-semibold">{paperDetails.paperName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Subject</p>
                <p className="font-semibold">{paperDetails.subjectName || 'N/A'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Marks</p>
                <p className="font-semibold">{paperDetails.totalMarks}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Tabs */}
      {selectedPaperId && (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pre-evaluation" className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Pre-Evaluation (OCR Correction)
            </TabsTrigger>
            <TabsTrigger value="post-evaluation" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Post-Evaluation (Grade Override)
            </TabsTrigger>
          </TabsList>

          {/* Pre-Evaluation Tab */}
          <TabsContent value="pre-evaluation" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Correct OCR-Extracted Answers</CardTitle>
                  <Button onClick={fetchExtractions} disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Load Students
                  </Button>
                </div>
                <CardDescription>
                  Review and correct student answers extracted by OCR before running LLM evaluation
                </CardDescription>
              </CardHeader>
              <CardContent>
                {students.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Student List */}
                    <div className="border rounded-lg p-4">
                      <h3 className="font-semibold mb-3">Students ({students.length})</h3>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {students.map((student) => (
                          <div
                            key={student.enrollmentNumber}
                            className={`p-3 rounded-lg cursor-pointer transition-colors ${selectedStudentEnrollment === student.enrollmentNumber
                              ? 'bg-blue-100 border-blue-300 border'
                              : 'bg-gray-50 hover:bg-gray-100'
                              }`}
                            onClick={() => fetchStudentDetails(student.enrollmentNumber)}
                          >
                            <p className="font-medium text-sm">{censorEnrollment(student.enrollmentNumber)}</p>
                            <p className="text-xs text-gray-500">
                              {student.answeredCount} / {student.questionCount} answered
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Question Details */}
                    <div className="lg:col-span-2 border rounded-lg p-4">
                      {selectedStudentEnrollment ? (
                        <>
                          <h3 className="font-semibold mb-3">
                            Answers for {censorEnrollment(selectedStudentEnrollment)}
                          </h3>
                          <div className="space-y-3 max-h-96 overflow-y-auto">
                            {studentQuestions.map((q) => {
                              const keyQ = answerKey.find(k => k.questionNumber === q.questionNumber);
                              return (
                                <div key={q.questionNumber} className="p-3 bg-gray-50 rounded-lg">
                                  <div className="flex justify-between items-start mb-2">
                                    <div>
                                      <span className="font-medium">Q{q.questionNumber}</span>
                                      {keyQ && (
                                        <Badge variant="secondary" className={`ml-2 ${getQuestionTypeColor(keyQ.questionType)}`}>
                                          {keyQ.questionType}
                                        </Badge>
                                      )}
                                    </div>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openCorrectionDialog(q)}
                                    >
                                      <Edit3 className="h-4 w-4 mr-1" />
                                      Edit
                                    </Button>
                                  </div>
                                  {keyQ?.questionText && (
                                    <p className="text-sm text-gray-600 mb-2">{keyQ.questionText}</p>
                                  )}
                                  <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="p-2 bg-green-50 rounded">
                                      <p className="text-xs text-green-700 font-medium">Answer Key:</p>
                                      <p className="text-green-800">{keyQ?.answer || 'N/A'}</p>
                                    </div>
                                    <div className="p-2 bg-blue-50 rounded">
                                      <p className="text-xs text-blue-700 font-medium">Student Answer:</p>
                                      <p className="text-blue-800">{q.answer || '(empty)'}</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-center h-48 text-gray-400">
                          Select a student to view their answers
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {students.length === 0 && !isLoading && (
                  <div className="text-center py-8 text-gray-500">
                    Click "Load Students" to view extracted answers
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Post-Evaluation Tab */}
          <TabsContent value="post-evaluation" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Evaluation Results
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Search by enrollment..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Button onClick={fetchResults} disabled={isLoading}>
                      {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Load Results
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  Review LLM evaluation results and manually override marks if needed
                </CardDescription>
              </CardHeader>
              <CardContent>
                {filteredResults.length > 0 ? (
                  <div className="space-y-2">
                    {filteredResults.map((result) => (
                      <div key={result._id} className="border rounded-lg overflow-hidden">
                        {/* Student Row */}
                        <div
                          className={`flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 ${expandedStudent === result.enrollmentNumber ? 'bg-gray-50' : ''
                            }`}
                          onClick={() => toggleStudent(result.enrollmentNumber)}
                        >
                          <div className="flex items-center gap-4">
                            {expandedStudent === result.enrollmentNumber ? (
                              <ChevronDown className="h-5 w-5 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400" />
                            )}
                            <div>
                              <p className="font-medium">{censorEnrollment(result.enrollmentNumber)}</p>
                              {result.hasOverrides && (
                                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                  Has Overrides
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <p className="text-sm text-gray-500">Marks</p>
                              <p className="font-semibold">{result.obtainedMarks.toFixed(1)} / {result.totalMarks}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-gray-500">Percentage</p>
                              <p className={`font-semibold ${result.percentage >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                                {result.percentage}%
                              </p>
                            </div>
                            <Badge className={`${getGradeColor(result.grade)} border`}>
                              {result.grade}
                            </Badge>
                          </div>
                        </div>

                        {/* Expanded Question Details */}
                        {expandedStudent === result.enrollmentNumber && (
                          <div className="border-t bg-white p-4">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-12">Q#</TableHead>
                                  <TableHead className="w-20">Type</TableHead>
                                  <TableHead className="w-1/4">Question</TableHead>
                                  <TableHead>Correct Answer</TableHead>
                                  <TableHead>Student Answer</TableHead>
                                  <TableHead className="text-center w-24">Marks</TableHead>
                                  <TableHead className="text-center w-24">Status</TableHead>
                                  <TableHead className="w-20">Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {result.questionStats.map((q) => (
                                  <TableRow
                                    key={q.questionNumber}
                                    className={
                                      q.obtained === q.marks ? 'bg-green-50/30' :
                                        q.obtained > 0 ? 'bg-yellow-50/30' :
                                          'bg-red-50/30'
                                    }
                                  >
                                    <TableCell className="font-semibold">{q.questionNumber}</TableCell>
                                    <TableCell>
                                      <Badge variant="secondary" className={getQuestionTypeColor(q.questionType)}>
                                        {q.questionType || 'N/A'}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm max-w-xs truncate" title={q.questionText}>
                                      {q.questionText?.substring(0, 50)}...
                                    </TableCell>
                                    <TableCell className="text-sm text-green-700 font-medium">
                                      {q.correctAnswer?.substring(0, 50)}
                                      {q.correctAnswer?.length > 50 && '...'}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {q.studentAnswer?.substring(0, 50)}
                                      {q.studentAnswer?.length > 50 && '...'}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      <span className="font-bold">
                                        {q.obtained.toFixed(1)} / {q.marks}
                                      </span>
                                      {q.manuallyOverridden && (
                                        <div className="text-xs text-amber-600 mt-1">
                                          (was {q.originalObtained?.toFixed(1)})
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      {q.obtained === q.marks ? (
                                        <CheckCircle className="h-5 w-5 text-green-600 mx-auto" />
                                      ) : q.obtained > 0 ? (
                                        <AlertCircle className="h-5 w-5 text-yellow-600 mx-auto" />
                                      ) : (
                                        <XCircle className="h-5 w-5 text-red-600 mx-auto" />
                                      )}
                                      {q.manuallyOverridden && (
                                        <Badge variant="outline" className="text-xs mt-1 bg-amber-50">
                                          Overridden
                                        </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openOverrideDialog(result.enrollmentNumber, q);
                                        }}
                                      >
                                        <Edit3 className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    {isLoading ? 'Loading...' : 'Click "Load Results" to view evaluation results'}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Override Dialog (Post-Evaluation) */}
      <Dialog open={overrideDialog} onOpenChange={setOverrideDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Override Evaluation Result</DialogTitle>
            <DialogDescription>
              Manually adjust marks for Question {currentOverride?.question.questionNumber}
            </DialogDescription>
          </DialogHeader>

          {currentOverride && (
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg text-sm">
                <p className="font-medium mb-1">Question:</p>
                <p className="text-gray-600">{currentOverride.question.questionText}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="font-medium text-green-800">Correct Answer:</p>
                  <p className="text-green-700">{currentOverride.question.correctAnswer}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="font-medium text-blue-800">Student Answer:</p>
                  <p className="text-blue-700">{currentOverride.question.studentAnswer}</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                <span className="text-sm">Current Marks:</span>
                <span className="font-bold">
                  {currentOverride.question.obtained} / {currentOverride.question.marks}
                </span>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">New Marks</label>
                <Input
                  type="number"
                  min="0"
                  max={currentOverride.question.marks}
                  step="0.5"
                  value={newMarks}
                  onChange={(e) => setNewMarks(e.target.value)}
                  placeholder={`0 - ${currentOverride.question.marks}`}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Feedback (optional)</label>
                <Textarea
                  value={overrideFeedback}
                  onChange={(e) => setOverrideFeedback(e.target.value)}
                  placeholder="Updated feedback for this question..."
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Override Reason</label>
                <Select value={overrideReason} onValueChange={setOverrideReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason for override" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="correct_answer_accepted">Correct answer - LLM error</SelectItem>
                    <SelectItem value="partial_credit">Partial credit adjustment</SelectItem>
                    <SelectItem value="ocr_misread">OCR misread student answer</SelectItem>
                    <SelectItem value="alternative_answer">Alternative valid answer</SelectItem>
                    <SelectItem value="grading_error">Grading logic error</SelectItem>
                    <SelectItem value="manual_review">Manual review decision</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleOverride} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Correction Dialog (Pre-Evaluation) */}
      <Dialog open={correctionDialog} onOpenChange={setCorrectionDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct Extracted Answer</DialogTitle>
            <DialogDescription>
              Edit the OCR-extracted answer for Question {currentCorrection?.questionNumber}
            </DialogDescription>
          </DialogHeader>

          {currentCorrection && (
            <div className="space-y-4">
              <div className="p-3 bg-green-50 rounded-lg text-sm">
                <p className="font-medium text-green-800 mb-1">Answer Key:</p>
                <p className="text-green-700">{currentCorrection.keyAnswer || 'N/A'}</p>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg text-sm">
                <p className="font-medium text-gray-700 mb-1">Original OCR Extraction:</p>
                <p className="text-gray-600">{currentCorrection.originalAnswer || '(empty)'}</p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Corrected Answer</label>
                <Textarea
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  placeholder="Enter the correct student answer..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectionDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCorrection} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EvaluationReview;
