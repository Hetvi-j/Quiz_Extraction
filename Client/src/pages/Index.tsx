import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, PlusCircle, BookOpen, BarChart3, Users, Target } from "lucide-react";

const Index = () => {
  const features = [
    {
      title: "Upload Content",
      description: "Upload PDFs and scanned images to extract text content",
      icon: Upload,
      href: "/upload",
      color: "text-blue-500"
    },
    {
      title: "Create Quizzes", 
      description: "Generate quizzes from your uploaded content",
      icon: PlusCircle,
      href: "/quiz-create",
      color: "text-green-500"
    },
    {
      title: "Take Quizzes",
      description: "Test your knowledge with interactive quizzes",
      icon: BookOpen,
      href: "/quizzes", 
      color: "text-purple-500"
    },
    {
      title: "View Analytics",
      description: "Track your learning progress and performance",
      icon: BarChart3,
      href: "/analytics",
      color: "text-orange-500"
    }
  ];

  const stats = [
    { label: "Active Users", value: "1,234", icon: Users },
    { label: "Quizzes Created", value: "5,678", icon: PlusCircle },
    { label: "Average Score", value: "85%", icon: Target }
  ];

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-6">
        <h1 className="text-4xl md:text-6xl font-bold gradient-text">
          QuizApp
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Transform your documents into interactive quizzes. Upload PDFs and images, 
          extract content with OCR, and create personalized learning experiences.
        </p>
        <div className="flex gap-4 justify-center">
          <Button asChild size="lg">
            <Link to="/upload">
              <Upload className="mr-2 h-5 w-5" />
              Start Uploading
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/quizzes">
              <BookOpen className="mr-2 h-5 w-5" />
              Browse Quizzes
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index} className="text-center">
              <CardContent className="pt-6">
                <Icon className="h-8 w-8 mx-auto mb-2 text-primary" />
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Features */}
      <div>
        <h2 className="text-3xl font-bold text-center mb-8">Key Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card key={index} className="hover:shadow-lg transition-shadow cursor-pointer">
                <Link to={feature.href}>
                  <CardHeader className="text-center">
                    <Icon className={`h-12 w-12 mx-auto mb-4 ${feature.color}`} />
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                    <CardDescription>{feature.description}</CardDescription>
                  </CardHeader>
                </Link>
              </Card>
            );
          })}
        </div>
      </div>

      {/* How it Works */}
      <div className="text-center space-y-8">
        <h2 className="text-3xl font-bold">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="space-y-4">
            <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto text-xl font-bold">
              1
            </div>
            <h3 className="text-xl font-semibold">Upload Documents</h3>
            <p className="text-muted-foreground">
              Upload PDFs or scanned images. Our OCR technology extracts text automatically.
            </p>
          </div>
          <div className="space-y-4">
            <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto text-xl font-bold">
              2
            </div>
            <h3 className="text-xl font-semibold">Create Quizzes</h3>
            <p className="text-muted-foreground">
              Generate quizzes from your content by selecting subjects and difficulty levels.
            </p>
          </div>
          <div className="space-y-4">
            <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto text-xl font-bold">
              3
            </div>
            <h3 className="text-xl font-semibold">Track Progress</h3>
            <p className="text-muted-foreground">
              Take quizzes and monitor your learning progress with detailed analytics.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
