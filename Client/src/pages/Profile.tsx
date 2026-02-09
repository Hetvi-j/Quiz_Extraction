// Profile.tsx
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User, Calendar, Settings } from "lucide-react";
import toast from "react-hot-toast";
import axios from "axios";

const API_BASE = "http://localhost:8080";

const Profile = () => {
  const { auth, setAuth } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    address: "",
  });

  // 🔹 Fetch profile from backend
 // 🔹 Fetch profile from backend
useEffect(() => {
  console.log("🔥 useEffect triggered");

  // 1. Get token (from context first, then localStorage)
  const storedAuth = JSON.parse(localStorage.getItem("auth") || "{}");
  const token = auth?.token || storedAuth?.token;

  console.log("🔍 Current auth from context:", auth);
  console.log("🔍 Token from localStorage:", storedAuth?.token);
  console.log("🔑 Using Bearer Token:", token ? `Bearer ${token}` : "❌ No token");

  if (!token) return; // stop if no token at all

  // 2. Fetch profile
  axios
    .get(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }, // ✅ always Bearer
    })
    .then((res) => {
      console.log("📥 /me response:", res.data);

      if (res.data.success && res.data.user) {
        // ✅ Save to context
        setAuth({ token, user: res.data.user });

        // ✅ Fill form with latest user info
        setFormData({
          name: res.data.user.name || "",
          email: res.data.user.email || "",
          password: "",
          phone: res.data.user.phone || "",
          address: res.data.user.address || "",
        });

        // ✅ Sync localStorage
        localStorage.setItem(
          "auth",
          JSON.stringify({ token, user: res.data.user })
        );

        console.log("✅ Auth + user saved to context & localStorage");
      } else {
        console.warn("❌ /me did not return success or user:", res.data);
      }
    })
    .catch((err) => {
      console.error("❌ Error fetching /me:", err.response?.data || err.message);
      toast.error("Session expired. Please login again.");
      setAuth(null);
      localStorage.removeItem("auth");
    });
}, [auth?.token]); // 🔄 re-run if token changes


  // 🔹 Save updated profile
 // 🔹 Save updated profile
const handleSave = async () => {
  try {
    // 1️⃣ Always get the raw token
   // const token = auth?.token || JSON.parse(localStorage.getItem("auth") || "{}")?.token;
  const storedAuth = JSON.parse(localStorage.getItem("auth") || "{}");
  const token = auth?.token || storedAuth?.token;

    console.log("🔹 Token used for handleSave:", token);

    if (!token) {
      toast.error("No token found. Please login again.");
      return;
    }

    // 2️⃣ PUT request with correct Authorization header
    const putRes = await axios.put(`${API_BASE}/api/v1/auth/profile`, formData, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("🔹 PUT /profile response:", putRes.data);

    // 3️⃣ Re-fetch latest user data
    const res = await axios.get(`${API_BASE}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("🔹 GET /me after update:", res.data);

    if (res.data.success && res.data.user) {
      // 4️⃣ Update context & localStorage
      setAuth({ token, user: res.data.user });
      localStorage.setItem("auth", JSON.stringify({ token, user: res.data.user }));
      toast.success("Profile Updated Successfully");
    }

    setIsEditing(false);
  } catch (err: any) {
    console.error("❌ Profile save error:", err.response?.data || err.message);
    toast.error(err.response?.data?.message || "Error updating profile");
  }
};



  if (!auth?.user) {
    return (
      <p className="text-center text-red-500">
        ⚠ Please login to see your profile.
      </p>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Profile</h1>
      <p className="text-muted-foreground">Manage your account details</p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Profile Information
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              <Settings className="mr-2 h-4 w-4" />
              {isEditing ? "Cancel" : "Edit"}
            </Button>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center space-x-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src="/placeholder-avatar.jpg" />
              <AvatarFallback>
                {formData.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <Label htmlFor="name">Full Name</Label>
              {isEditing ? (
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="mt-2"
                />
              ) : (
                <div className="flex items-center gap-2 mt-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>{auth.user.name}</span>
                </div>
              )}
            </div>

            {/* Email */}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={formData.email} disabled />
            </div>

            {/* Password */}
            {isEditing && (
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  className="mt-2"
                />
              </div>
            )}

            {/* Phone */}
            <div>
              <Label htmlFor="phone">Phone</Label>
              {isEditing ? (
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  className="mt-2"
                />
              ) : (
                <span className="mt-2 block">{auth.user.phone}</span>
              )}
            </div>

            {/* Address */}
            <div>
              <Label htmlFor="address">Address</Label>
              {isEditing ? (
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) =>
                    setFormData({ ...formData, address: e.target.value })
                  }
                  className="mt-2"
                />
              ) : (
                <span className="mt-2 block">{auth.user.address}</span>
              )}
            </div>

            {/* Join Date */}
            <div>
              <Label>Member Since</Label>
              <div className="flex items-center gap-2 mt-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>September 2025</span>
              </div>
            </div>
          </div>

          {isEditing && (
            <div className="flex gap-2">
              <Button onClick={handleSave}>Save Changes</Button>
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
