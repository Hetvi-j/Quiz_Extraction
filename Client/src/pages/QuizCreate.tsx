import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PlusCircle, Settings, Eye } from "lucide-react";

const QuizCreate = () => {
  const [quizName, setQuizName] = useState("");
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([]);
  const [numQuestions, setNumQuestions] = useState("10");
  const [timeLimit, setTimeLimit] = useState("");

  const subjects = ["Mathematics", "Physics", "Chemistry", "Biology", "English", "History"];
  const difficulties = ["Easy", "Medium", "Hard"];

  const handleSubjectChange = (subject: string, checked: boolean) => {
    if (checked) {
      setSelectedSubjects([...selectedSubjects, subject]);
    } else {
      setSelectedSubjects(selectedSubjects.filter(s => s !== subject));
    }
  };

  const handleDifficultyChange = (difficulty: string, checked: boolean) => {
    if (checked) {
      setSelectedDifficulties([...selectedDifficulties, difficulty]);
    } else {
      setSelectedDifficulties(selectedDifficulties.filter(d => d !== difficulty));
    }
  };

  const handleCreateQuiz = () => {
    // TODO: Implement quiz creation logic
    console.log("Creating quiz:", {
      name: quizName,
      subjects: selectedSubjects,
      difficulties: selectedDifficulties,
      numQuestions,
      timeLimit
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Create Quiz</h1>
        <p className="text-muted-foreground">Generate quizzes from your uploaded content</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quiz Configuration</CardTitle>
          <CardDescription>
            Set up filters and parameters for your quiz
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label htmlFor="quiz-name">Quiz Name</Label>
            <Input
              id="quiz-name"
              placeholder="Enter quiz name..."
              value={quizName}
              onChange={(e) => setQuizName(e.target.value)}
              className="mt-2"
            />
          </div>

          <div>
            <Label>Subjects</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
              {subjects.map((subject) => (
                <div key={subject} className="flex items-center space-x-2">
                  <Checkbox
                    id={subject}
                    checked={selectedSubjects.includes(subject)}
                    onCheckedChange={(checked) => 
                      handleSubjectChange(subject, checked as boolean)
                    }
                  />
                  <Label htmlFor={subject} className="text-sm">{subject}</Label>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label>Difficulty Levels</Label>
            <div className="flex gap-6 mt-2">
              {difficulties.map((difficulty) => (
                <div key={difficulty} className="flex items-center space-x-2">
                  <Checkbox
                    id={difficulty}
                    checked={selectedDifficulties.includes(difficulty)}
                    onCheckedChange={(checked) => 
                      handleDifficultyChange(difficulty, checked as boolean)
                    }
                  />
                  <Label htmlFor={difficulty} className="text-sm">{difficulty}</Label>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="num-questions">Number of Questions</Label>
              <Select value={numQuestions} onValueChange={setNumQuestions}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 Questions</SelectItem>
                  <SelectItem value="10">10 Questions</SelectItem>
                  <SelectItem value="15">15 Questions</SelectItem>
                  <SelectItem value="20">20 Questions</SelectItem>
                  <SelectItem value="25">25 Questions</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="time-limit">Time Limit (minutes)</Label>
              <Input
                id="time-limit"
                type="number"
                placeholder="Optional"
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button 
              onClick={handleCreateQuiz}
              disabled={!quizName || selectedSubjects.length === 0 || selectedDifficulties.length === 0}
              className="flex-1"
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Quiz
            </Button>
            <Button variant="outline">
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button variant="outline">
              <Settings className="mr-2 h-4 w-4" />
              Advanced
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default QuizCreate;