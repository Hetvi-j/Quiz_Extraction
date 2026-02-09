import React, { useState, useEffect } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, BookOpen, Shuffle, Eye, EyeOff, FileText, Download, Trash2, BarChart3, PieChart as PieChartIcon } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList
} from 'recharts';

const API_BASE_URL = "http://localhost:8080/api/v1/question-bank";

interface Question {
  questionText: string;
  questionType?: string;
  marks?: number;
  options?: string[];
  answer?: string;
  frequency?: number;
  sourceFiles?: string[];
  addedAt?: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  accuracy?: number;
}

const DIFFICULTY_COLORS = {
  'Easy': '#22c55e',
  'Medium': '#eab308',
  'Hard': '#ef4444',
};

interface SubjectInfo {
  subject: string;
  totalQuestions: number;
  lastUpdated: string;
}

const QuestionBank = () => {
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);

  // Quiz generation state
  const [quizCount, setQuizCount] = useState<number>(5);
  const [generatedQuiz, setGeneratedQuiz] = useState<Question[] | null>(null);
  const [generating, setGenerating] = useState(false);

  // Migration state
  const [migrating, setMigrating] = useState(false);
  const [migrateSubject, setMigrateSubject] = useState<string>("DSA");

  // Analytics state
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Difficulty filter state
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'Easy' | 'Medium' | 'Hard'>('all');

  // Fetch all subjects on mount
  useEffect(() => {
    fetchSubjects();
  }, []);

  // Fetch questions when subject changes
  useEffect(() => {
    if (selectedSubject) {
      fetchQuestions(selectedSubject);
    }
  }, [selectedSubject]);

  const fetchSubjects = async () => {
    try {
      setLoadingSubjects(true);
      const response = await axios.get(`${API_BASE_URL}/subjects`);
      setSubjects(response.data.subjects || []);
    } catch (error) {
      console.error("Error fetching subjects:", error);
    } finally {
      setLoadingSubjects(false);
    }
  };

  const fetchQuestions = async (subject: string) => {
    try {
      setLoading(true);
      setGeneratedQuiz(null);
      const response = await axios.get(`${API_BASE_URL}/${subject}`);
      setQuestions(response.data.questions || []);
    } catch (error) {
      console.error("Error fetching questions:", error);
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  };

  const generateQuiz = async () => {
    if (!selectedSubject) return;

    try {
      setGenerating(true);
      const response = await axios.post(`${API_BASE_URL}/generate`, {
        subject: selectedSubject,
        count: quizCount
      });
      setGeneratedQuiz(response.data.questions || []);
    } catch (error) {
      console.error("Error generating quiz:", error);
    } finally {
      setGenerating(false);
    }
  };

  const toggleQuestion = (index: number) => {
    setExpandedQuestion(expandedQuestion === index ? null : index);
  };

  // Calculate difficulty distribution for charts
  const getDifficultyDistribution = () => {
    const distribution = { Easy: 0, Medium: 0, Hard: 0 };
    questions.forEach(q => {
      const diff = q.difficulty || 'Medium';
      distribution[diff as keyof typeof distribution]++;
    });
    return [
      { name: 'Easy', value: distribution.Easy },
      { name: 'Medium', value: distribution.Medium },
      { name: 'Hard', value: distribution.Hard }
    ].filter(item => item.value > 0);
  };

  // Filter questions by difficulty
  const filteredQuestions = difficultyFilter === 'all'
    ? questions
    : questions.filter(q => (q.difficulty || 'Medium') === difficultyFilter);

  // Get difficulty color class
  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty) {
      case 'Easy': return 'text-green-600 bg-green-100';
      case 'Medium': return 'text-yellow-600 bg-yellow-100';
      case 'Hard': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  // Prepare bar chart data showing questions per difficulty
  const difficultyBarData = () => {
    const data: { difficulty: string; count: number; questions: string[] }[] = [
      { difficulty: 'Easy', count: 0, questions: [] },
      { difficulty: 'Medium', count: 0, questions: [] },
      { difficulty: 'Hard', count: 0, questions: [] }
    ];

    questions.forEach((q, idx) => {
      const diff = q.difficulty || 'Medium';
      const item = data.find(d => d.difficulty === diff);
      if (item) {
        item.count++;
        item.questions.push(`Q${idx + 1}`);
      }
    });

    return data;
  };

  const migrateExistingQuizzes = async (answerKeyOnly: boolean = true) => {
    try {
      setMigrating(true);
      const response = await axios.post(`${API_BASE_URL}/migrate`, {
        subject: migrateSubject,
        answerKeyOnly: answerKeyOnly
      });
      alert(`Migration successful!\n${response.data.message}\nQuestions added: ${response.data.totalQuestionsAdded}\nDuplicates merged: ${response.data.duplicatesMerged}`);
      // Refresh subjects and questions
      fetchSubjects();
      if (selectedSubject) {
        fetchQuestions(selectedSubject);
      }
    } catch (error) {
      console.error("Error migrating:", error);
      alert("Migration failed. Check console for details.");
    } finally {
      setMigrating(false);
    }
  };

  const clearBank = async () => {
    if (!confirm(`Are you sure you want to clear ALL questions from ${migrateSubject} question bank?`)) {
      return;
    }
    try {
      const response = await axios.post(`${API_BASE_URL}/clear`, {
        subject: migrateSubject
      });
      alert(response.data.message);
      fetchSubjects();
      if (selectedSubject === migrateSubject) {
        setQuestions([]);
      }
    } catch (error) {
      console.error("Error clearing:", error);
      alert("Failed to clear question bank.");
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BookOpen className="h-8 w-8" />
            Question Bank
          </h1>
          <p className="text-gray-600 mt-1">
            Browse and generate quizzes from your question collection
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={migrateSubject} onValueChange={setMigrateSubject}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DSA">DSA</SelectItem>
              <SelectItem value="MC">MC</SelectItem>
              <SelectItem value="CHEMISTRY">Chemistry</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => migrateExistingQuizzes(true)}
            disabled={migrating}
            variant="outline"
            title="Import only from answer key (enrollment 0)"
          >
            {migrating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Import Answer Key
          </Button>
          <Button
            onClick={clearBank}
            variant="destructive"
            size="sm"
            title="Clear all questions from this subject"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Subject Selection and Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Select Subject</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSubjects ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading subjects...
              </div>
            ) : (
              <Select value={selectedSubject} onValueChange={setSelectedSubject}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.subject} value={s.subject}>
                      {s.subject} ({s.totalQuestions} questions)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Questions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-indigo-600">
              {selectedSubject ? questions.length : "-"}
            </div>
            {selectedSubject && questions.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setShowAnalytics(!showAnalytics)}
              >
                {showAnalytics ? <EyeOff className="h-4 w-4 mr-1" /> : <BarChart3 className="h-4 w-4 mr-1" />}
                {showAnalytics ? 'Hide' : 'Show'} Analytics
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Generate Quiz</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="quizCount" className="whitespace-nowrap">Questions:</Label>
              <Input
                id="quizCount"
                type="number"
                min={1}
                max={questions.length || 50}
                value={quizCount}
                onChange={(e) => setQuizCount(parseInt(e.target.value) || 5)}
                className="w-20"
              />
            </div>
            <Button
              onClick={generateQuiz}
              disabled={!selectedSubject || generating || questions.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Shuffle className="mr-2 h-4 w-4" />
                  Generate Random Quiz
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Difficulty Analytics Section */}
      {showAnalytics && selectedSubject && questions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bar Chart - Questions per Difficulty */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Questions by Difficulty
              </CardTitle>
              <CardDescription>
                Distribution of questions across difficulty levels
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={difficultyBarData()}
                    margin={{ top: 10, right: 30, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="difficulty" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: '#f0f0f0' }}
                      contentStyle={{ borderRadius: '8px', border: '1px solid #ccc' }}
                    />
                    <Bar dataKey="count" name="Questions" radius={[4, 4, 0, 0]}>
                      {difficultyBarData().map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={DIFFICULTY_COLORS[entry.difficulty as keyof typeof DIFFICULTY_COLORS]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Pie Chart - Difficulty Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChartIcon className="h-5 w-5" />
                Difficulty Distribution
              </CardTitle>
              <CardDescription>
                Percentage breakdown of Easy, Medium, and Hard questions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={getDifficultyDistribution()}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {getDifficultyDistribution().map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={DIFFICULTY_COLORS[entry.name as keyof typeof DIFFICULTY_COLORS]}
                        />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="inside"
                        fill="#fff"
                        stroke="none"
                        fontSize={14}
                        fontWeight="bold"
                      />
                    </Pie>
                    <Tooltip />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      layout="horizontal"
                      iconType="circle"
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Summary Stats */}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="p-2 bg-green-50 rounded-lg">
                  <p className="font-bold text-green-700">
                    {questions.filter(q => q.difficulty === 'Easy').length}
                  </p>
                  <p className="text-green-600">Easy</p>
                </div>
                <div className="p-2 bg-yellow-50 rounded-lg">
                  <p className="font-bold text-yellow-700">
                    {questions.filter(q => q.difficulty === 'Medium' || !q.difficulty).length}
                  </p>
                  <p className="text-yellow-600">Medium</p>
                </div>
                <div className="p-2 bg-red-50 rounded-lg">
                  <p className="font-bold text-red-700">
                    {questions.filter(q => q.difficulty === 'Hard').length}
                  </p>
                  <p className="text-red-600">Hard</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generated Quiz */}
      {generatedQuiz && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700">
              <FileText className="h-5 w-5" />
              Generated Quiz ({generatedQuiz.length} Questions)
            </CardTitle>
            <CardDescription>
              Random selection from {selectedSubject} question bank
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {generatedQuiz.map((q, index) => (
                <div key={index} className="p-4 bg-white rounded-lg border">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium">
                        <span className="text-indigo-600 mr-2">Q{index + 1}.</span>
                        {q.questionText}
                      </p>
                      {q.options && q.options.length > 0 && (
                        <ul className="mt-2 ml-6 space-y-1">
                          {q.options.map((opt, i) => (
                            <li key={i} className="text-gray-600">{opt}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {q.marks && (
                      <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                        {q.marks} marks
                      </span>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t">
                    <span className="text-sm text-green-700 font-medium">
                      Answer: {q.answer || "N/A"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Questions Table */}
      {selectedSubject && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>All Questions - {selectedSubject}</CardTitle>
                <CardDescription className="mt-1">
                  Showing {filteredQuestions.length} of {questions.length} questions
                </CardDescription>
              </div>
              {/* Difficulty Filter Buttons */}
              <div className="flex gap-2">
                <Button
                  variant={difficultyFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDifficultyFilter('all')}
                >
                  All ({questions.length})
                </Button>
                <Button
                  variant={difficultyFilter === 'Easy' ? 'default' : 'outline'}
                  size="sm"
                  className={difficultyFilter === 'Easy' ? 'bg-green-600 hover:bg-green-700' : 'text-green-600 border-green-300 hover:bg-green-50'}
                  onClick={() => setDifficultyFilter('Easy')}
                >
                  Easy ({questions.filter(q => q.difficulty === 'Easy').length})
                </Button>
                <Button
                  variant={difficultyFilter === 'Medium' ? 'default' : 'outline'}
                  size="sm"
                  className={difficultyFilter === 'Medium' ? 'bg-yellow-600 hover:bg-yellow-700' : 'text-yellow-600 border-yellow-300 hover:bg-yellow-50'}
                  onClick={() => setDifficultyFilter('Medium')}
                >
                  Medium ({questions.filter(q => q.difficulty === 'Medium' || !q.difficulty).length})
                </Button>
                <Button
                  variant={difficultyFilter === 'Hard' ? 'default' : 'outline'}
                  size="sm"
                  className={difficultyFilter === 'Hard' ? 'bg-red-600 hover:bg-red-700' : 'text-red-600 border-red-300 hover:bg-red-50'}
                  onClick={() => setDifficultyFilter('Hard')}
                >
                  Hard ({questions.filter(q => q.difficulty === 'Hard').length})
                </Button>
              </div>
            </div>
            <CardDescription>
              {questions.length} questions in the bank
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            ) : questions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No questions found for this subject. Upload some papers first!
              </div>
            ) : filteredQuestions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No {difficultyFilter} questions found. Try a different filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Question</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Answer</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Difficulty</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Frequency</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sources</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredQuestions.map((q) => {
                      const originalIndex = questions.indexOf(q);
                      return (
                      <React.Fragment key={originalIndex}>
                        <tr className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{originalIndex + 1}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 max-w-md">
                            <p className="truncate" title={q.questionText}>
                              {q.questionText}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-sm text-green-700 font-medium">
                            {q.answer || "N/A"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(q.difficulty)}`}>
                              {q.difficulty || 'Medium'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              (q.frequency || 1) > 2
                                ? "bg-red-100 text-red-700"
                                : (q.frequency || 1) > 1
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-700"
                            }`}>
                              {q.frequency || 1}x
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {q.sourceFiles?.length || 1} file(s)
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleQuestion(originalIndex)}
                            >
                              {expandedQuestion === originalIndex ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </td>
                        </tr>
                        {expandedQuestion === originalIndex && (
                          <tr>
                            <td colSpan={7} className="px-4 py-4 bg-gray-50">
                              <div className="space-y-2">
                                <p><strong>Full Question:</strong> {q.questionText}</p>
                                {q.options && q.options.length > 0 && (
                                  <div>
                                    <strong>Options:</strong>
                                    <ul className="ml-4 list-disc">
                                      {q.options.map((opt, i) => (
                                        <li key={i}>{opt}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <p><strong>Type:</strong> {q.questionType || "N/A"}</p>
                                <p><strong>Marks:</strong> {q.marks || "N/A"}</p>
                                <p>
                                  <strong>Difficulty:</strong>{' '}
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getDifficultyColor(q.difficulty)}`}>
                                    {q.difficulty || 'Medium'}
                                  </span>
                                  {q.accuracy !== undefined && (
                                    <span className="ml-2 text-gray-500">({q.accuracy.toFixed(1)}% accuracy)</span>
                                  )}
                                </p>
                                <p><strong>Source Files:</strong> {q.sourceFiles?.join(", ") || "N/A"}</p>
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
            )}
          </CardContent>
        </Card>
      )}

      {/* No Subject Selected */}
      {!selectedSubject && !loadingSubjects && (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-16 w-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Select a Subject to View Questions
            </h3>
            <p className="text-gray-500">
              {subjects.length === 0
                ? "No subjects found. Upload some quiz papers first!"
                : "Choose a subject from the dropdown above to browse questions."
              }
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default QuestionBank;
