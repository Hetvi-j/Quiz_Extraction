import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext'; // adjust path

function Login() {
  const { setAuth } = useAuth(); // ✅ must be inside component
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // const handleSubmit = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   setMessage('');
  //   setLoading(true);

  //   try {
  //     const response = await fetch('http://localhost:8080/api/v1/auth/login', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify(formData),
  //     });

  //     const data = await response.json();

  //     if (data.success && data.token && data.user) {
  //       setMessage('Login successful! Redirecting...');

  //       // Save auth in localStorage
  //       const newAuth = { token: data.token, user: data.user };
  //       localStorage.setItem('auth', JSON.stringify(newAuth));

  //       // Update AuthContext
  //       setAuth(newAuth);

  //       // Notify other tabs/components
  //       window.dispatchEvent(new Event('storage'));

  //       // Redirect to profile after 1s
  //       setTimeout(() => navigate('/profile'), 1000);
  //     } else {
  //       setMessage(data.message || 'Login failed.');
  //     }
  //   } catch (err) {
  //     console.error('Login error:', err);
  //     setMessage('An error occurred. Please try again.');
  //   } finally {
  //     setLoading(false);
  //   }
  // };
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setMessage('');
  setLoading(true);

  try {
    console.log("📤 Sending login request with formData:", formData);

    const response = await fetch('http://localhost:8080/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    console.log("📥 Response received, parsing JSON...");
    const data = await response.json();
    console.log("📄 Parsed login response:", data);

    if (data.success && data.token && data.user) {
      console.log("✅ Login successful. Token and user received.");

      setMessage('Login successful! Redirecting...');

      // Save auth in localStorage
      const newAuth = { token: data.token, user: data.user };
      localStorage.setItem('auth', JSON.stringify(newAuth));
      console.log("💾 Auth saved to localStorage:", newAuth);

      // Update AuthContext
      setAuth(newAuth);
      console.log("🔑 AuthContext updated with newAuth");

      // Notify other tabs/components
      window.dispatchEvent(new Event('storage'));
      console.log("📢 Dispatched storage event for other components");

      // Redirect to profile after 1s
      setTimeout(() => {
        console.log("➡ Redirecting to /profile");
        navigate('/profile');
      }, 1000);
    } else {
      console.warn("⚠️ Login failed:", data.message);
      setMessage(data.message || 'Login failed.');
    }
  } catch (err) {
    console.error('❌ Login error:', err);
    setMessage('An error occurred. Please try again.');
  } finally {
    setLoading(false);
    console.log("⏹ Login request finished, loading set to false");
  }
};

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-3xl font-bold text-center mb-6">Welcome Back!</h2>
        <p className="text-center text-gray-500 mb-8">Sign in to your QuizApp account.</p>

        {message && (
          <div
            className={`p-3 rounded-md mb-4 text-center ${
              message.includes('successful') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={formData.password}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            disabled={loading}
          >
            {loading ? 'Logging In...' : 'Login'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <a href="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}

export default Login;
