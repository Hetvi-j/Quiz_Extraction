import { useState } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HYBRID_OCR_URL = "http://localhost:8080/api/v1/hybrid-ocr";

const HybridOcrPanel = () => {
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<any>(null);

  const upload = async (endpoint: "extract-key" | "extract-response", file: File | null) => {
    if (!file) return;
    setLoading(true);
    setStatus(`Uploading to ${endpoint}...`);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await axios.post(`${HYBRID_OCR_URL}/${endpoint}`, form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setResult(res.data);
      setStatus(`Success: ${endpoint}`);
    } catch (error: any) {
      setStatus(error?.response?.data?.message || error.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Hybrid OCR (MCQ Guard + Groq)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            MCQ answers are stabilized with hybrid extraction. FILL_BLANK, TRUE_FALSE, SHORT, LONG stay on Groq flow.
          </p>
          <div className="space-y-2">
            <Label htmlFor="hybrid-key">Answer Key File</Label>
            <Input id="hybrid-key" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff" onChange={(e) => setKeyFile(e.target.files?.[0] || null)} />
            <Button disabled={!keyFile || loading} onClick={() => upload("extract-key", keyFile)}>
              Extract Key (Hybrid)
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hybrid-response">Student Response File</Label>
            <Input id="hybrid-response" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff" onChange={(e) => setResponseFile(e.target.files?.[0] || null)} />
            <Button disabled={!responseFile || loading} onClick={() => upload("extract-response", responseFile)}>
              Extract Response (Hybrid)
            </Button>
          </div>
          <p className="text-sm">{status}</p>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Last Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[480px]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default HybridOcrPanel;

