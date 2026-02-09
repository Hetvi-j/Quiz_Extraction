import { useState, useEffect } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, Clock, BookOpen, Trophy, Loader2, FileText, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

const API_BASE_URL = "http://localhost:8080/api/v1/papers";

interface Paper {
  _id: string;
  paperName: string;
  paperNumber: number;
  totalMarks: number;
  totalStudents: number;
  totalQuestions?: number;
  key?: {
    uploadedAt: string;
    questions: any[];
  };
  createdAt: string;
}

interface Subject {
  _id: string;
  name: string;
  code: string;
  description: string;
  totalPapers: number;
  totalQuestions: number;
}

interface SubjectWithPapers extends Subject {
  papers: Paper[];
}

const Quizzes = () => {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<SubjectWithPapers[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const getAuthHeaders = () => ({
    headers: { Authorization: `Bearer ${auth.token}` }
  });

  useEffect(() => {
    fetchAllQuizzes();
  }, [auth.token]);

  const fetchAllQuizzes = async () => {
    try {
      setIsLoading(true);
      setError("");

      // First get all subjects
      const subjectsRes = await axios.get(`${API_BASE_URL}/subjects`, getAuthHeaders());
      const subjectsList = subjectsRes.data.subjects || [];

      // Then fetch papers for each subject
      const subjectsWithPapers = await Promise.all(
        subjectsList.map(async (subject: Subject) => {
          try {
            const papersRes = await axios.get(
              `${API_BASE_URL}/subjects/${subject._id}`,
              getAuthHeaders()
            );
            return {
              ...subject,
              papers: papersRes.data.papers || []
            };
          } catch {
            return { ...subject, papers: [] };
          }
        })
      );

      setSubjects(subjectsWithPapers);
    } catch (err: any) {
      console.error("Error fetching quizzes:", err);
      setError(err.response?.data?.message || "Failed to load quizzes");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartQuiz = (paperId: string, paperName: string) => {
    // Navigate to quiz taking page (you can implement this route)
    console.log("Starting quiz:", paperId, paperName);
    // navigate(`/quiz/${paperId}`);
  };

  const getDifficultyBadge = (totalMarks: number) => {
    if (totalMarks <= 20) return { label: "Easy", variant: "default" as const };
    if (totalMarks <= 50) return { label: "Medium", variant: "secondary" as const };
    return { label: "Hard", variant: "destructive" as const };
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center py-16">
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={fetchAllQuizzes}>Try Again</Button>
        </div>
      </div>
    );
  }

  // Flatten all papers from all subjects for display
  const allQuizzes = subjects.flatMap(subject =>
    subject.papers
      .filter(paper => paper.key?.uploadedAt) // Only show papers with uploaded keys
      .map(paper => ({
        ...paper,
        subjectName: subject.name,
        subjectCode: subject.code
      }))
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Available Quizzes</h1>
        <p className="text-muted-foreground">Take quizzes to test your knowledge</p>
      </div>

      {allQuizzes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookOpen className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-semibold text-gray-500">No Quizzes Available</h2>
            <p className="text-gray-400 mt-2">
              No quizzes have been created yet. Check back later!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {allQuizzes.map((quiz) => {
            const difficulty = getDifficultyBadge(quiz.totalMarks);
            const questionCount = quiz.key?.questions?.length || 0;

            return (
              <Card key={quiz._id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        {quiz.paperName}
                      </CardTitle>
                      <CardDescription>{quiz.subjectName}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="secondary">{quiz.subjectCode || quiz.subjectName}</Badge>
                      <Badge variant={difficulty.variant}>
                        {difficulty.label}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-4 w-4" />
                        {questionCount} questions
                      </span>
                      <span className="flex items-center gap-1">
                        <Trophy className="h-4 w-4" />
                        {quiz.totalMarks} marks
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {quiz.totalStudents} attempts
                      </span>
                    </div>
                    <Button onClick={() => handleStartQuiz(quiz._id, quiz.paperName)}>
                      <PlayCircle className="mr-2 h-4 w-4" />
                      Start Quiz
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Show subjects summary */}
      {subjects.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Browse by Subject</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subjects.map(subject => (
              <Card key={subject._id} className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{subject.name}</CardTitle>
                  {subject.code && (
                    <Badge variant="outline" className="w-fit">{subject.code}</Badge>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {subject.papers.filter(p => p.key?.uploadedAt).length} quizzes available
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Quizzes;
