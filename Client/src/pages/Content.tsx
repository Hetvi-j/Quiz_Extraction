import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Loader2, Zap, AlertTriangle, CheckCircle, BarChart, PieChart as PieChartIcon, Users, TrendingUp } from 'lucide-react';
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

import AnalysisPieChart from './AnalysisPieChart';
import AnalysisBarGraph from './AnalysisBarGraph';

// API Base URL - Change port if needed
const API_BASE_URL = 'http://localhost:8080/api/v1/subject-upload';

const SubjectAnalyzer = () => {
    // Subject states
    const [subjects, setSubjects] = useState([]);
    const [selectedSubject, setSelectedSubject] = useState('');
    const [selectedQuiz, setSelectedQuiz] = useState('');
    const [quizzes, setQuizzes] = useState([]);
    const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

    // Analysis states
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [status, setStatus] = useState({ type: '', message: '' });
    const [analysisData, setAnalysisData] = useState(null);
    const [showBarGraph, setShowBarGraph] = useState(false);
    const [showPieChart, setShowPieChart] = useState(false);

    // Fetch subjects on mount
    useEffect(() => {
        fetchSubjects();
    }, []);

    // Fetch quizzes when subject changes
    useEffect(() => {
        if (selectedSubject) {
            fetchQuizzes(selectedSubject);
        }
    }, [selectedSubject]);

    // Fetch all subjects with quizzes
    const fetchSubjects = async () => {
        setIsLoadingSubjects(true);
        try {
            const response = await fetch(`${API_BASE_URL}/quiz-subjects`);
            if (response.ok) {
                const data = await response.json();
                setSubjects(data.subjects || []);
            }
        } catch (error) {
            console.error('Error fetching subjects:', error);
            setStatus({ type: 'error', message: 'Failed to fetch subjects from server' });
        } finally {
            setIsLoadingSubjects(false);
        }
    };

    // Fetch quizzes for a subject
    const fetchQuizzes = async (subjectId) => {
        try {
            const response = await fetch(`${API_BASE_URL}/quiz-subjects/${subjectId}/quizzes`);
            if (response.ok) {
                const data = await response.json();
                setQuizzes(data.quizzes || []);
                if (data.quizzes && data.quizzes.length > 0) {
                    setSelectedQuiz(data.quizzes[0]._id);
                }
            }
        } catch (error) {
            console.error('Error fetching quizzes:', error);
        }
    };

    // Fetch difficulty analysis for selected quiz
    const fetchDifficultyAnalysis = async () => {
        if (!selectedSubject || !selectedQuiz) {
            setStatus({ type: 'error', message: 'Please select a subject and quiz first' });
            return;
        }

        setIsAnalyzing(true);
        setStatus({ type: 'info', message: 'Fetching class performance analysis...' });
        setAnalysisData(null);
        setShowBarGraph(false);
        setShowPieChart(false);

        try {
            const response = await fetch(
                `${API_BASE_URL}/quiz-subjects/${selectedSubject}/quizzes/${selectedQuiz}/difficulty`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch difficulty analysis');
            }

            const data = await response.json();
            setAnalysisData(data);

            const totalAttempts = data.difficultyAnalysis?.totalAttempts || 0;
            const totalQuestions = data.difficultyAnalysis?.questionStats?.length || 0;

            setStatus({
                type: 'success',
                message: `Analysis complete! ${totalAttempts} students, ${totalQuestions} questions analyzed.`
            });

        } catch (error) {
            console.error('Analysis Error:', error);
            setStatus({
                type: 'error',
                message: `Analysis Failed: ${error.message}`
            });
        } finally {
            setIsAnalyzing(false);
        }
    };

    const toggleBarGraph = () => {
        setShowBarGraph(!showBarGraph);
        setShowPieChart(false);
    };

    const togglePieChart = () => {
        setShowPieChart(!showPieChart);
        setShowBarGraph(false);
    };

    const getDifficultyClass = (level) => {
        const upperLevel = level?.toUpperCase();
        switch (upperLevel) {
            case 'EASY': return 'text-green-600 font-bold bg-green-100';
            case 'MEDIUM': return 'text-yellow-600 font-bold bg-yellow-100';
            case 'HARD': return 'text-red-600 font-bold bg-red-100';
            default: return 'text-gray-500';
        }
    };

    const getStatusIndicator = (type) => {
        switch (type) {
            case 'success': return <CheckCircle className="h-5 w-5 text-green-500 mr-2" />;
            case 'error': return <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />;
            case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />;
            case 'info': return <Loader2 className="h-5 w-5 text-blue-500 mr-2 animate-spin" />;
            default: return null;
        }
    };

    const analysis = analysisData?.difficultyAnalysis;
    const questionStats = analysis?.questionStats || [];
    const overallStats = analysis?.overallStats || {};
    const distribution = analysis?.difficultyDistribution || {};

    return (
        <div className="space-y-6 max-w-6xl mx-auto p-4">
            {/* Subject & Quiz Selection Card */}
            <Card className="shadow-lg border-t-4 border-indigo-600">
                <CardHeader>
                    <CardTitle className="text-2xl flex items-center">
                        <Users className="h-6 w-6 mr-2 text-indigo-600" />
                        Class Performance Analyzer
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-gray-600">
                        Select a subject and quiz to see how many students got each question correct based on class balance.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Subject Select */}
                        <div>
                            <label className="text-sm font-medium mb-2 block">Select Subject</label>
                            <Select value={selectedSubject} onValueChange={(value) => {
                                setSelectedSubject(value);
                                setSelectedQuiz('');
                                setAnalysisData(null);
                            }}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose a subject" />
                                </SelectTrigger>
                                <SelectContent>
                                    {subjects.map((subject) => (
                                        <SelectItem key={subject._id} value={subject._id}>
                                            {subject.name} ({subject.quizCount} quizzes)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Quiz Select */}
                        <div>
                            <label className="text-sm font-medium mb-2 block">Select Quiz</label>
                            <Select value={selectedQuiz} onValueChange={setSelectedQuiz} disabled={!selectedSubject}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Choose a quiz" />
                                </SelectTrigger>
                                <SelectContent>
                                    {quizzes.map((quiz) => (
                                        <SelectItem key={quiz._id} value={quiz._id}>
                                            {quiz.quizName} ({quiz.totalAttempts} attempts)
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Analyze Button */}
                        <div className="flex items-end">
                            <Button
                                onClick={fetchDifficultyAnalysis}
                                disabled={isAnalyzing || !selectedSubject || !selectedQuiz}
                                className="w-full bg-indigo-600 hover:bg-indigo-700"
                            >
                                {isAnalyzing ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        <Zap className="mr-2 h-4 w-4" />
                                        Analyze Class Performance
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* Status Message */}
                    {status.message && (
                        <div className={`flex items-center p-3 rounded-md font-medium ${
                            status.type === 'success' ? 'bg-green-100 text-green-700' :
                            status.type === 'error' ? 'bg-red-100 text-red-700' :
                            status.type === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-blue-100 text-blue-700'
                        }`}>
                            {getStatusIndicator(status.type)}
                            <span>{status.message}</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Overall Statistics Card */}
            {analysisData && analysis?.status === 'analyzed' && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl flex items-center">
                            <TrendingUp className="h-5 w-5 mr-2" />
                            Class Overview - {analysisData.subject} ({analysisData.quiz})
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                            <div className="bg-blue-50 p-4 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Total Students</p>
                                <p className="text-3xl font-bold text-blue-600">{analysis.totalAttempts}</p>
                            </div>
                            <div className="bg-purple-50 p-4 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Total Questions</p>
                                <p className="text-3xl font-bold text-purple-600">{questionStats.length}</p>
                            </div>
                            <div className="bg-green-50 p-4 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Avg Accuracy</p>
                                <p className="text-3xl font-bold text-green-600">{overallStats.averageAccuracy}%</p>
                            </div>
                            <div className="bg-orange-50 p-4 rounded-lg text-center">
                                <p className="text-sm text-gray-600">Class Average</p>
                                <p className="text-3xl font-bold text-orange-600">{overallStats.averagePercentage}%</p>
                            </div>
                            <div className="bg-teal-50 p-4 rounded-lg text-center">
                                <p className="text-sm text-gray-600">QIS Score</p>
                                <p className="text-3xl font-bold text-teal-600">{overallStats.QIS}</p>
                            </div>
                            <div className={`p-4 rounded-lg text-center ${getDifficultyClass(overallStats.overallDifficulty)}`}>
                                <p className="text-sm">Overall Difficulty</p>
                                <p className="text-2xl font-bold">{overallStats.overallDifficulty}</p>
                            </div>
                        </div>

                        {/* Difficulty Distribution */}
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                            <p className="text-sm font-medium mb-2">Question Difficulty Distribution:</p>
                            <div className="flex gap-4">
                                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                                    Easy: {distribution.easy || 0}
                                </span>
                                <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
                                    Medium: {distribution.medium || 0}
                                </span>
                                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
                                    Hard: {distribution.hard || 0}
                                </span>
                            </div>
                        </div>

                        {/* Insights */}
                        {analysis.insights && analysis.insights.length > 0 && (
                            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                                <p className="text-sm font-medium mb-2">Insights:</p>
                                <ul className="space-y-1">
                                    {analysis.insights.map((insight, idx) => (
                                        <li key={idx} className="text-sm text-gray-700">{insight}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Chart Toggle Buttons */}
            {questionStats.length > 0 && (
                <div className="flex justify-end space-x-2">
                    <Button
                        onClick={toggleBarGraph}
                        variant="outline"
                        className={`${showBarGraph ? 'bg-indigo-100' : 'bg-white'} hover:bg-indigo-50 text-indigo-600 border-indigo-600`}
                    >
                        <BarChart className="h-4 w-4 mr-2" />
                        {showBarGraph ? 'Hide Bar Graph' : 'View Bar Graph'}
                    </Button>
                    <Button
                        onClick={togglePieChart}
                        variant="outline"
                        className={`${showPieChart ? 'bg-purple-100' : 'bg-white'} hover:bg-purple-50 text-purple-600 border-purple-600`}
                    >
                        <PieChartIcon className="h-4 w-4 mr-2" />
                        {showPieChart ? 'Hide Pie Chart' : 'View Pie Chart'}
                    </Button>
                </div>
            )}

            {/* Bar Graph - Students Correct per Question */}
            {showBarGraph && questionStats.length > 0 && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">Students Correct per Question</CardTitle>
                    </CardHeader>
                    <CardContent className="h-96">
                        <AnalysisBarGraph data={questionStats.map(q => ({
                            questionNumber: q.questionNumber,
                            correctCount: q.correctCount,
                            accuracy: q.accuracy
                        }))} />
                    </CardContent>
                </Card>
            )}

            {/* Pie Chart - Difficulty Distribution */}
            {showPieChart && questionStats.length > 0 && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">Question Difficulty Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="h-96">
                        <AnalysisPieChart data={questionStats.map(q => ({
                            difficultyLevel: q.difficulty
                        }))} />
                    </CardContent>
                </Card>
            )}

            {/* Question-wise Analysis Table */}
            {questionStats.length > 0 && (
                <Card className="shadow-lg">
                    <CardHeader>
                        <CardTitle className="text-xl">
                            Each Question Analysis - How Many Got It Correct
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[80px]">Q No.</TableHead>
                                    <TableHead className="w-[35%]">Question Text</TableHead>
                                    <TableHead className="text-center">Total Attempts</TableHead>
                                    <TableHead className="text-center">
                                        <span className="text-green-600">Correct</span>
                                    </TableHead>
                                    <TableHead className="text-center">
                                        <span className="text-red-600">Wrong</span>
                                    </TableHead>
                                    <TableHead className="text-center">Accuracy</TableHead>
                                    <TableHead className="text-center">Marks</TableHead>
                                    <TableHead className="text-center w-[100px]">Difficulty</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {questionStats.map((q) => (
                                    <TableRow key={q.questionNumber}>
                                        <TableCell className="font-semibold">{q.questionNumber}</TableCell>
                                        <TableCell className="text-sm max-w-xs truncate">{q.questionText}</TableCell>
                                        <TableCell className="text-center">{q.totalAttempts}</TableCell>
                                        <TableCell className="text-center font-bold text-green-600">{q.correctCount}</TableCell>
                                        <TableCell className="text-center text-red-600">{q.totalAttempts - q.correctCount}</TableCell>
                                        <TableCell className="text-center font-bold">{q.accuracy}%</TableCell>
                                        <TableCell className="text-center">{q.marks}</TableCell>
                                        <TableCell className="text-center">
                                            <span className={`px-2 py-1 rounded-full text-xs ${getDifficultyClass(q.difficulty)}`}>
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

            {/* Hardest & Easiest Questions */}
            {analysis?.hardestQuestions && analysis?.easiestQuestions && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Hardest Questions */}
                    <Card className="shadow-lg border-l-4 border-red-500">
                        <CardHeader>
                            <CardTitle className="text-lg text-red-600">Top 5 Hardest Questions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2">
                                {analysis.hardestQuestions.map((q, idx) => (
                                    <li key={idx} className="flex justify-between items-center p-2 bg-red-50 rounded">
                                        <span className="text-sm">Q{q.questionNumber}: {q.questionText}</span>
                                        <span className="text-red-600 font-bold">{q.accuracy}%</span>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>

                    {/* Easiest Questions */}
                    <Card className="shadow-lg border-l-4 border-green-500">
                        <CardHeader>
                            <CardTitle className="text-lg text-green-600">Top 5 Easiest Questions</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2">
                                {analysis.easiestQuestions.map((q, idx) => (
                                    <li key={idx} className="flex justify-between items-center p-2 bg-green-50 rounded">
                                        <span className="text-sm">Q{q.questionNumber}: {q.questionText}</span>
                                        <span className="text-green-600 font-bold">{q.accuracy}%</span>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
};

export default SubjectAnalyzer;
