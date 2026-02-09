import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import Index from "./pages/Index";
import Upload from "./pages/Upload";
import QuizCreate from "./pages/QuizCreate";
import Content from "./pages/Content"; // <-- This is the required import
import Quizzes from "./pages/Quizzes";
import Analytics from "./pages/Analytics";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import RegisterForm from "./pages/Register";
import Login from "./pages/login";
import QuestionBank from "./pages/QuestionBank";
import SubjectUpload from "./pages/SubjectUpload";
import SubjectManager from "./pages/SubjectManager";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Index />} />
            <Route path="upload" element={<Upload />} />
            <Route path="quiz-create" element={<QuizCreate />} />
           <Route path="content" element={<Content />} />
           <Route path="quizzes" element={<Quizzes />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="question-bank" element={<QuestionBank />} />
            <Route path="subject-upload" element={<SubjectUpload />} />
            <Route path="subjects" element={<SubjectManager />} />
            <Route path="profile" element={<Profile />} />
            <Route path="/register" element={<RegisterForm />} />
            <Route path="/login" element={<Login />} />

          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
