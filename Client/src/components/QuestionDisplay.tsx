import React from "react";
import { Badge } from "@/components/ui/badge";
import { FileText, List, ToggleLeft, PenLine, AlignLeft } from "lucide-react";

interface QuestionDisplayProps {
  question: {
    questionText: string;
    questionType: string;
    marks: number;
    options?: string[];
    Answer?: string;
  };
  index: number;
  showAnswer?: boolean;
}

const QUESTION_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; icon: React.ElementType }
> = {
  MCQ: {
    label: "MCQ",
    color: "text-blue-700",
    bgColor: "bg-blue-100",
    icon: List,
  },
  TRUE_FALSE: {
    label: "True/False",
    color: "text-teal-700",
    bgColor: "bg-teal-100",
    icon: ToggleLeft,
  },
  FILL_BLANK: {
    label: "Fill Blank",
    color: "text-orange-700",
    bgColor: "bg-orange-100",
    icon: PenLine,
  },
  SHORT: {
    label: "Short Answer",
    color: "text-amber-700",
    bgColor: "bg-amber-100",
    icon: FileText,
  },
  LONG: {
    label: "Long Answer",
    color: "text-indigo-700",
    bgColor: "bg-indigo-100",
    icon: AlignLeft,
  },
};

function getTypeConfig(questionType: string) {
  return (
    QUESTION_TYPE_CONFIG[questionType] || {
      label: questionType,
      color: "text-gray-700",
      bgColor: "bg-gray-100",
      icon: FileText,
    }
  );
}

const QuestionDisplay: React.FC<QuestionDisplayProps> = ({
  question,
  index,
  showAnswer = true,
}) => {
  const config = getTypeConfig(question.questionType);
  const IconComponent = config.icon;
  const isObjective = ["MCQ", "TRUE_FALSE"].includes(question.questionType);
  const isSubjective = ["SHORT", "LONG"].includes(question.questionType);

  return (
    <div className="p-4 border rounded-lg hover:bg-gray-50/50 transition-colors">
      {/* Header: question number, type badge, marks */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <p className="font-medium text-gray-800">
            <span className="text-indigo-600 font-semibold mr-2">
              Q{index + 1}.
            </span>
            {question.questionText}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={`text-xs ${config.color} ${config.bgColor}`}>
            <IconComponent className="h-3 w-3 mr-1" />
            {config.label}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {question.marks} mark{question.marks !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Options for MCQ / True-False */}
      {isObjective &&
        question.options &&
        question.options.length > 0 && (
          <div className="ml-8 mb-2 flex flex-col gap-1">
            {question.options.map((opt, optIdx) => {
              const letter = String.fromCharCode(65 + optIdx);
              const isCorrectOption =
                showAnswer &&
                question.Answer &&
                question.Answer.split(",").some(
                  (a) => a.trim().toUpperCase() === letter
                );
              return (
                <p
                  key={optIdx}
                  className={`text-sm px-2 py-0.5 rounded ${
                    isCorrectOption
                      ? "bg-green-50 text-green-700 font-medium"
                      : "text-gray-600"
                  }`}
                >
                  {opt}
                  {isCorrectOption && (
                    <span className="ml-1 text-green-600 text-xs font-bold">
                      (Correct)
                    </span>
                  )}
                </p>
              );
            })}
          </div>
        )}

      {/* Answer section */}
      {showAnswer && question.Answer && (
        <div
          className={`ml-8 mt-2 p-3 rounded border ${
            isSubjective
              ? "bg-emerald-50 border-emerald-200"
              : "bg-green-50 border-green-200"
          }`}
        >
          <p
            className={`text-sm ${
              isSubjective ? "text-emerald-700" : "text-green-700"
            }`}
          >
            <span className="font-semibold">
              {isSubjective ? "Model Answer:" : "Answer:"}
            </span>{" "}
            {isSubjective ? (
              <span className="whitespace-pre-wrap block mt-1">
                {question.Answer}
              </span>
            ) : (
              question.Answer
            )}
          </p>
        </div>
      )}
    </div>
  );
};

// Summary bar component that shows question type distribution
export const QuestionTypeSummary: React.FC<{
  questions: Array<{ questionType: string }>;
}> = ({ questions }) => {
  const typeCounts: Record<string, number> = {};
  questions.forEach((q) => {
    const t = q.questionType || "MCQ";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(typeCounts).map(([type, count]) => {
        const config = getTypeConfig(type);
        const IconComponent = config.icon;
        return (
          <Badge key={type} className={`${config.color} ${config.bgColor}`}>
            <IconComponent className="h-3 w-3 mr-1" />
            {config.label}: {count}
          </Badge>
        );
      })}
      <Badge variant="outline">Total: {questions.length}</Badge>
    </div>
  );
};

export default QuestionDisplay;
