import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Home,
  Upload,
  FileText,
  PlusCircle,
  User,
  BookOpen,
  LogIn,
  UserPlus,
  Library,
  FolderUp,
  GraduationCap,
  BarChart3
} from "lucide-react";
import { useAuth } from "@/context/AuthContext"; // adjust path as needed

const navItemsLoggedIn = [
  { to: "/", label: "Home", icon: Home },
  { to: "/subjects", label: "Subjects", icon: GraduationCap },
  // { to: "/question-bank", label: "Question Bank", icon: Library },
  { to: "/quiz-create", label: "Create Quiz", icon: PlusCircle },
  { to: "/quizzes", label: "Take Quiz", icon: BookOpen },
  { to: "/profile", label: "Profile", icon: User },
];

const navItemsLoggedOut = [
  { to: "/", label: "Home", icon: Home },
  { to: "/register", label: "Register", icon: UserPlus },
];

export const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { auth, setAuth } = useAuth(); // ✅ use context instead of localStorage

  const isLoggedIn = !!auth?.token;

  const handleLogout = () => {
    localStorage.removeItem("auth"); // remove saved auth
    setAuth({ user: null, token: "" }); // reset context
    navigate("/"); // redirect to home after logout
  };

  return (
    <nav className="border-b bg-card">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center space-x-2">
            <BookOpen className="h-6 w-6" />
            <span className="font-bold text-xl">QuizApp</span>
          </Link>

          <div className="flex items-center space-x-2">
            {isLoggedIn ? (
              <>
                {navItemsLoggedIn.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.to;
                  return (
                    <Button
                      key={item.to}
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      asChild
                    >
                      <Link to={item.to} className="flex items-center space-x-2">
                        <Icon className="h-4 w-4" />
                        <span className="hidden sm:inline">{item.label}</span>
                      </Link>
                    </Button>
                  );
                })}

                {/* Logout */}
                <Button onClick={handleLogout} variant="ghost" size="sm">
                  <LogIn className="h-4 w-4 transform rotate-180 mr-2" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </>
            ) : (
              <>
                {navItemsLoggedOut.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.to;
                  return (
                    <Button
                      key={item.to}
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      asChild
                    >
                      <Link to={item.to} className="flex items-center space-x-2">
                        <Icon className="h-4 w-4" />
                        <span className="hidden sm:inline">{item.label}</span>
                      </Link>
                    </Button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};
