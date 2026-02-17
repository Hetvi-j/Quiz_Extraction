import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Brain,
} from "lucide-react";

interface EvalResult {
  questionNumber: number;
  questionText: string;
  questionType: string;
  maxMarks: number;
  obtainedMarks: number;
  isCorrect: boolean;
  isPartial: boolean;
  correctAnswer?: string;
  studentAnswer?: string;
  feedback?: string;
  keyPoints?: string[];
  missedPoints?: string[];
  confidence?: number;
}

interface EvalResultDisplayProps {
  results: EvalResult[];
  summary?: {
    totalQuestions: number;
    objectiveCount: number;
    subjectiveCount: number;
    totalMarks: number;
    obtainedMarks: number;
    percentage: number;
    fullCorrect: number;
    partialCorrect: number;
    wrong: number;
  };
}

const EvalResultDisplay: React.FC<EvalResultDisplayProps> = ({
  results,
  summary,
}) => {
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(null);

  const toggleExpand = (qNum: number) => {
    setExpandedQuestion((prev) => (prev === qNum ? null : qNum));
  };

  const getStatusColor = (result: EvalResult) => {
    if (result.isCorrect) return "border-green-200 bg-green-50/30";
    if (result.isPartial) return "border-amber-200 bg-amber-50/30";
    return "border-red-200 bg-red-50/30";
  };

  const getStatusIcon = (result: EvalResult) => {
    if (result.isCorrect)
      return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (result.isPartial)
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    return <XCircle className="h-5 w-5 text-red-500" />;
  };

  const getStatusLabel = (result: EvalResult) => {
    if (result.isCorrect) return "Full Marks";
    if (result.isPartial) return "Partial";
    return "Incorrect";
  };

  const isSubjective = (type: string) =>
    ["SHORT", "LONG"].includes(type?.toUpperCase());

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      {summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="h-5 w-5 text-indigo-600" />
              Evaluation Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-indigo-50 rounded-lg text-center border border-indigo-200">
                <p className="text-2xl font-bold text-indigo-700">
                  {summary.obtainedMarks}/{summary.totalMarks}
                </p>
                <p className="text-xs text-indigo-600">Total Score</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg text-center border border-blue-200">
                <p className="text-2xl font-bold text-blue-700">
                  {summary.percentage}%
                </p>
                <p className="text-xs text-blue-600">Percentage</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg text-center border border-green-200">
                <p className="text-2xl font-bold text-green-700">
                  {summary.fullCorrect}
                </p>
                <p className="text-xs text-green-600">Correct</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg text-center border border-amber-200">
                <p className="text-2xl font-bold text-amber-700">
                  {summary.partialCorrect}
                </p>
                <p className="text-xs text-amber-600">Partial</p>
              </div>
            </div>

            {/* Objective vs Subjective Breakdown */}
            {(summary.objectiveCount > 0 || summary.subjectiveCount > 0) && (
              <div className="flex gap-3 mt-3">
                {summary.objectiveCount > 0 && (
                  <Badge className="bg-blue-100 text-blue-700">
                    Objective: {summary.objectiveCount} questions
                  </Badge>
                )}
                {summary.subjectiveCount > 0 && (
                  <Badge className="bg-indigo-100 text-indigo-700">
                    <Brain className="h-3 w-3 mr-1" />
                    Subjective: {summary.subjectiveCount} questions (LLM
                    evaluated)
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Individual Question Results */}
      <div className="space-y-2">
        {results.map((result) => (
          <div
            key={result.questionNumber}
            className={`border rounded-lg transition-all ${getStatusColor(result)}`}
          >
            {/* Question Header Row */}
            <div
              className="flex items-center justify-between p-3 cursor-pointer"
              onClick={() => toggleExpand(result.questionNumber)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {getStatusIcon(result)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    <span className="text-indigo-600 mr-1">
                      Q{result.questionNumber}.
                    </span>
                    {result.questionText}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {isSubjective(result.questionType) && (
                  <Badge className="bg-indigo-100 text-indigo-700 text-xs">
                    <Brain className="h-3 w-3 mr-1" />
                    LLM
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    result.isCorrect
                      ? "border-green-300 text-green-700"
                      : result.isPartial
                        ? "border-amber-300 text-amber-700"
                        : "border-red-300 text-red-700"
                  }`}
                >
                  {result.obtainedMarks}/{result.maxMarks}
                </Badge>
                <span className="text-xs text-gray-500">
                  {getStatusLabel(result)}
                </span>
                {expandedQuestion === result.questionNumber ? (
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                )}
              </div>
            </div>

            {/* Expanded Detail */}
            {expandedQuestion === result.questionNumber && (
              <div className="px-4 pb-4 border-t border-gray-200/50">
                <div className="pt-3 space-y-3">
                  {/* Answers Comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {result.correctAnswer && (
                      <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                        <p className="text-xs font-semibold text-green-700 mb-1">
                          Model Answer
                        </p>
                        <p className="text-sm text-green-800 whitespace-pre-wrap">
                          {result.correctAnswer}
                        </p>
                      </div>
                    )}
                    {result.studentAnswer && (
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <p className="text-xs font-semibold text-gray-700 mb-1">
                          Student Answer
                        </p>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">
                          {result.studentAnswer}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* LLM Feedback (for subjective questions) */}
                  {result.feedback && isSubjective(result.questionType) && (
                    <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                      <p className="text-xs font-semibold text-indigo-700 mb-1 flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        AI Evaluation Feedback
                      </p>
                      <p className="text-sm text-indigo-800">
                        {result.feedback}
                      </p>
                    </div>
                  )}

                  {/* Key Points / Missed Points */}
                  {((result.keyPoints && result.keyPoints.length > 0) ||
                    (result.missedPoints &&
                      result.missedPoints.length > 0)) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {result.keyPoints && result.keyPoints.length > 0 && (
                        <div className="p-3 bg-green-50/50 rounded-lg border border-green-100">
                          <p className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                            <ThumbsUp className="h-3 w-3" />
                            Points Covered
                          </p>
                          <ul className="text-sm text-green-700 list-disc list-inside">
                            {result.keyPoints.map((point, i) => (
                              <li key={i}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {result.missedPoints &&
                        result.missedPoints.length > 0 && (
                          <div className="p-3 bg-red-50/50 rounded-lg border border-red-100">
                            <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                              <ThumbsDown className="h-3 w-3" />
                              Points Missed
                            </p>
                            <ul className="text-sm text-red-700 list-disc list-inside">
                              {result.missedPoints.map((point, i) => (
                                <li key={i}>{point}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>
                  )}

                  {/* Confidence indicator for LLM-graded questions */}
                  {isSubjective(result.questionType) &&
                    result.confidence !== undefined && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>AI Confidence:</span>
                        <div className="flex-1 max-w-[200px] h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              result.confidence >= 0.8
                                ? "bg-green-500"
                                : result.confidence >= 0.5
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{
                              width: `${(result.confidence || 0) * 100}%`,
                            }}
                          />
                        </div>
                        <span>
                          {((result.confidence || 0) * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default EvalResultDisplay;
