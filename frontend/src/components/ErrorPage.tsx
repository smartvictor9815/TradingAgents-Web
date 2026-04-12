import { useRouteError, useNavigate } from "react-router";
import { Button } from "./ui/button";
import { Home } from "lucide-react";
import { useEffect } from "react";

export function ErrorPage() {
  const error = useRouteError() as {
    statusText?: string;
    message?: string;
  };
  const navigate = useNavigate();

  useEffect(() => {
    // Auto redirect to home after 2 seconds
    const timer = setTimeout(() => {
      navigate("/", { replace: true });
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-green-400 font-mono flex items-center justify-center p-4">
      <div className="border-2 border-green-500 rounded-lg p-8 max-w-md text-center space-y-4">
        <h1 className="text-2xl font-bold">404 - Page Not Found</h1>
        <p className="text-green-600">
          {error?.statusText || error?.message || "The page you're looking for doesn't exist."}
        </p>
        <p className="text-sm text-green-700">Redirecting to home page...</p>
        <Button
          onClick={() => navigate("/", { replace: true })}
          className="bg-green-600 hover:bg-green-700 text-black"
        >
          <Home className="w-4 h-4 mr-2" />
          Go to Home
        </Button>
      </div>
    </div>
  );
}
