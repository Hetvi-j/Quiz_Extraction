import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, BarChart3, PieChart as PieChartIcon, RefreshCw } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import AnalysisBarGraph from './AnalysisBarGraph';
import AnalysisPieChart from './AnalysisPieChart';

// API Endpoints
const API_BASE_URL = 'http://localhost:8080/api/v1';
const API_EVALUATE_URL = `${API_BASE_URL}/results/quiz/compare_all`;
const API_CALCULATE_ACCURACY_URL = `${API_BASE_URL}/accuracy/calculate`;
const API_QUIZ_SUMMARY_URL = `${API_BASE_URL}/quiz/summary`;
const API_QUIZ_ANALYZE_URL = `${API_BASE_URL}/quiz/analyze`;

const Analytics = () => {
    // Evaluation states
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [status, setStatus] = useState({ type: '', message: '' });
    const [evaluationResults, setEvaluationResults] = useState([]);
    const [expandedEnrollment, setExpandedEnrollment] = useState(null);

    // Analysis states
    const [analysisData, setAnalysisData] = useState([]);
    const [quizStats, setQuizStats] = useState(null);
    const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
    const [selectedCase, setSelectedCase] = useState('2'); // Default to Case 2 (Standard)

    // Censor enrollment number for privacy
    const censorEnrollmentNumber = (enrollmentNumber) => {
        if (!enrollmentNumber) return "*****";
        const str = String(enrollmentNumber);
        if (str.length <= 5) return "*".repeat(str.length);
        const safePart = str.substring(0, str.length - 5);
        return `${safePart}*****`;
    };

    // Fetch analysis data on component mount
    useEffect(() => {
        fetchAnalysisData();
    }, []);

    // Fetch quiz summary and analysis
    const fetchAnalysisData = async () => {
        setIsLoadingAnalysis(true);
        try {
            const [summaryRes, analyzeRes] = await Promise.all([
                fetch(API_QUIZ_SUMMARY_URL),
                fetch(API_QUIZ_ANALYZE_URL)
            ]);

            if (summaryRes.ok) {
                const summaryData = await summaryRes.json();
                setAnalysisData(summaryData.summary || []);
            }

            if (analyzeRes.ok) {
                const analyzeData = await analyzeRes.json();
                setQuizStats(analyzeData);
            }
        } catch (error) {
            console.error('Error fetching analysis data:', error);
        } finally {
            setIsLoadingAnalysis(false);
        }
    };

    // Calculate accuracy with selected case
    const handleCalculateAccuracy = async () => {
        setIsLoadingAnalysis(true);
        setStatus({ type: 'info', message: `Calculating accuracy using Case ${selectedCase} thresholds...` });

        try {
            const response = await fetch(`${API_CALCULATE_ACCURACY_URL}?case=${selectedCase}`, {
                method: 'POST',
            });

            if (response.ok) {
                const data = await response.json();
                setAnalysisData(data.data || []);
                setStatus({ type: 'success', message: data.message });
                // Refresh analysis data
                await fetchAnalysisData();
            } else {
                throw new Error('Failed to calculate accuracy');
            }
        } catch (error) {
            console.error('Error calculating accuracy:', error);
            setStatus({ type: 'error', message: `Error: ${error.message}` });
        } finally {
            setIsLoadingAnalysis(false);
        }
    };

    // Evaluate all students
    const handleEvaluate = async () => {
        setEvaluationResults([]);
        setExpandedEnrollment(null);
        setIsEvaluating(true);
        setStatus({ type: 'info', message: 'Evaluation in progress. Comparing all student answers...' });

        try {
            const response = await fetch(API_EVALUATE_URL, { method: 'POST' });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Server error' }));
                throw new Error(errorData.message || 'Server returned an error');
            }

            const data = await response.json();
            setEvaluationResults(data.results || []);
            setStatus({
                type: 'success',
                message: data.message || `Successfully evaluated ${data.results.length} students.`
            });
        } catch (error) {
            console.error('Evaluation Error:', error);
            setStatus({
                type: 'error',
                message: `Evaluation Failed: ${error.message}`
            });
            setEvaluationResults([]);
        } finally {
            setIsEvaluating(false);
        }
    };

    const getStatusIndicator = (type) => {
        switch (type) {
            case 'success':
                return <CheckCircle className="h-5 w-5 text-green-500 mr-2" />;
            case 'error':
                return <XCircle className="h-5 w-5 text-red-500 mr-2" />;
            case 'info':
                return <Loader2 className="h-5 w-5 text-blue-500 mr-2 animate-spin" />;
            default:
                return null;
        }
    };

    const toggleDetails = (enrollmentNumber) => {
        setExpandedEnrollment(expandedEnrollment === enrollmentNumber ? null : enrollmentNumber);
    };

    const getDifficultyColor = (difficulty) => {
        switch (difficulty) {
            case 'Easy': return 'text-green-600 bg-green-100';
            case 'Medium': return 'text-yellow-600 bg-yellow-100';
            case 'Hard': return 'text-red-600 bg-red-100';
            default: return 'text-gray-600 bg-gray-100';
        }
    };

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4">
            {/* Quiz Grading Section */}
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2">
                        <BarChart3 className="h-6 w-6" />
                        Quiz Grading System
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Click the button below to compare all student answers against the answer key (enrollment 0).
                    </p>

                    <Button
                        onClick={handleEvaluate}
                        disabled={isEvaluating}
                        className="w-full bg-indigo-600 hover:bg-indigo-700"
                    >
                        {isEvaluating ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Evaluating...
                            </>
                        ) : (
                            'Start Comparison & Grading'
                        )}
                    </Button>

                    {status.message && (
                        <div className={`flex items-center p-3 rounded-md font-medium ${status.type === 'success' ? 'bg-green-100 text-green-700' :
                            status.type === 'error' ? 'bg-red-100 text-red-700' :
                                'bg-blue-100 text-blue-700'
                            }`}>
                            {getStatusIndicator(status.type)}
                            <span>{status.message}</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Difficulty Analysis Section */}
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle className="text-xl flex items-center gap-2">
                        <PieChartIcon className="h-6 w-6" />
                        Question Difficulty Analysis
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-4 items-end">
                        <div className="flex-1">
                            <label className="text-sm font-medium mb-2 block">Select Threshold Case</label>
                            <Select value={selectedCase} onValueChange={setSelectedCase}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select case" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">Case 1: Lenient (Easy: 70%, Hard: 25%)</SelectItem>
                                    <SelectItem value="2">Case 2: Standard (Easy: 80%, Hard: 29%)</SelectItem>
                                    <SelectItem value="3">Case 3: Strict (Easy: 93%, Hard: 30%)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={handleCalculateAccuracy} disabled={isLoadingAnalysis}>
                            {isLoadingAnalysis ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Calculate Accuracy
                        </Button>
                    </div>

                    {/* Quiz Stats Overview */}
                    {quizStats && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                            <div className="bg-blue-50 p-3 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Total Questions</p>
                                <p className="text-2xl font-bold text-blue-600">{quizStats.totalQuestions}</p>
                            </div>
                            <div className="bg-green-50 p-3 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Avg Accuracy</p>
                                <p className="text-2xl font-bold text-green-600">{quizStats.avgAccuracy}%</p>
                            </div>
                            <div className="bg-purple-50 p-3 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Std Deviation</p>
                                <p className="text-2xl font-bold text-purple-600">{quizStats.stdDeviation}</p>
                            </div>
                            <div className="bg-orange-50 p-3 rounded-lg text-center">
                                <p className="text-sm text-gray-600">QIS Score</p>
                                <p className="text-2xl font-bold text-orange-600">{quizStats.QIS}</p>
                            </div>
                            <div className={`p-3 rounded-lg text-center ${getDifficultyColor(quizStats.overallLevel)}`}>
                                <p className="text-sm">Overall Level</p>
                                <p className="text-2xl font-bold">{quizStats.overallLevel}</p>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Charts Section */}
            {analysisData.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Bar Graph */}
                    <Card className="shadow-lg">
                        <CardHeader>
                            <CardTitle className="text-lg">Question-wise Performance</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px]">
                                <AnalysisBarGraph data={analysisData.map((q, i) => ({
                                    questionNumber: i + 1,
                                    correctCount: parseInt(q.accuracy) || 0,
                                    accuracy: parseFloat(q.accuracy) || 0
                                }))} />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Pie Chart */}
                    <Card className="shadow-lg">
                        <CardHeader>
                            <CardTitle className="text-lg">Difficulty Distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px]">
                                <AnalysisPieChart data={analysisData.map(q => ({
                                    difficultyLevel: q.difficulty
                                }))} />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Question-wise Analysis Table */}
            {analysisData.length > 0 && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">Each Question Analysis</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[80px]">Q No.</TableHead>
                                    <TableHead>Question Text</TableHead>
                                    <TableHead className="text-center w-[120px]">Accuracy</TableHead>
                                    <TableHead className="text-center w-[120px]">Difficulty</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analysisData.map((q, index) => (
                                    <TableRow key={index}>
                                        <TableCell className="font-semibold">{q.questionNumber || index + 1}</TableCell>
                                        <TableCell className="max-w-md truncate">{q.questionText}</TableCell>
                                        <TableCell className="text-center font-medium">{q.accuracy}</TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-1 rounded-full text-sm font-medium ${getDifficultyColor(q.difficulty)}`}>
                                                {q.difficulty}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Evaluation Results Table */}
            {evaluationResults.length > 0 && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">
                            Student Results ({evaluationResults.length} Students)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[120px]">Enrollment No.</TableHead>
                                    <TableHead>Total Marks</TableHead>
                                    <TableHead>Obtained Marks</TableHead>
                                    <TableHead className="text-right w-[120px]">Percentage</TableHead>
                                    <TableHead className="w-[100px]">Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {evaluationResults.map((result) => (
                                    <React.Fragment key={result.enrollmentNumber}>
                                        <TableRow>
                                            <TableCell className="font-medium">
                                                {censorEnrollmentNumber(result.enrollmentNumber)}
                                            </TableCell>
                                            <TableCell>{result.totalMarks.toFixed(2)}</TableCell>
                                            <TableCell>{result.obtainedMarks.toFixed(2)}</TableCell>
                                            <TableCell className={`text-right font-bold ${result.percentage >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                                                {result.percentage}%
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => toggleDetails(result.enrollmentNumber)}
                                                >
                                                    {expandedEnrollment === result.enrollmentNumber ? 'Hide' : 'View'}
                                                </Button>
                                            </TableCell>
                                        </TableRow>

                                        {expandedEnrollment === result.enrollmentNumber && (
                                            <TableRow className="bg-gray-50">
                                                <TableCell colSpan={5} className="p-0">
                                                    <div className="p-4">
                                                        <h4 className="text-md font-semibold mb-2">
                                                            Detailed Question Analysis
                                                        </h4>
                                                        <QuestionDetailsTable questionStats={result.questionStats} />
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </React.Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

// Nested component for question details
const QuestionDetailsTable = ({ questionStats }) => {
    return (
        <Table className="bg-white border">
            <TableHeader>
                <TableRow>
                    <TableHead className="w-[50px]">Q No.</TableHead>
                    <TableHead className="w-[40%]">Question</TableHead>
                    <TableHead>Correct Answer</TableHead>
                    <TableHead>Student Answer</TableHead>
                    <TableHead className="text-center">Max Marks</TableHead>
                    <TableHead className="text-center">Obtained</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {questionStats.map((q) => (
                    <TableRow
                        key={q.questionNumber}
                        className={q.obtained === q.marks ? 'bg-green-50/50' : q.obtained > 0 ? 'bg-yellow-50/50' : 'bg-red-50/50'}
                    >
                        <TableCell className="font-semibold">{q.questionNumber}</TableCell>
                        <TableCell className="text-sm italic max-w-xs truncate">{q.questionText}</TableCell>
                        <TableCell className="font-medium text-green-700">{q.correctAnswer}</TableCell>
                        <TableCell className="text-red-700">{q.studentAnswer}</TableCell>
                        <TableCell className="text-center">{q.marks.toFixed(2)}</TableCell>
                        <TableCell className="text-center font-bold">{q.obtained.toFixed(2)}</TableCell>
                        <TableCell className="text-center">
                            {q.obtained === q.marks ? (
                                <CheckCircle className="h-5 w-5 text-green-600 mx-auto" />
                            ) : q.obtained > 0 ? (
                                <span className="text-yellow-600">Partial</span>
                            ) : (
                                <XCircle className="h-5 w-5 text-red-600 mx-auto" />
                            )}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

export default Analytics;
