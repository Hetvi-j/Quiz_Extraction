import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload as UploadIcon,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Plus,
  FolderOpen,
  Trash2,
  BookOpen,
  Library,
  Sparkles,
  Zap
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import QuestionDisplay, { QuestionTypeSummary } from '@/components/QuestionDisplay';

const API_BASE_URL = "http://localhost:8080/api/v1/subject-upload";

interface Subject {
  _id: string;
  name: string;
  description: string;
  totalUploads: number;
  totalQuestions: number;
  createdAt: string;
}

interface UploadResult {
  fileName: string;
  status: string;
  questionCount?: number;
  documentInfo?: {
    enrollmentNumber: number;
    date: string;
    totalMarks: number;
  };
  error?: string;
  uploadId?: string;
}

interface ProcessedUpload {
  _id: string;
  originalName: string;
  questionCount: number;
  status: string;
  extractedData: {
    documentInfo: {
      enrollmentNumber: number;
      date: string;
      totalMarks: number;
    };
    questions: Array<{
      questionText: string;
      questionType: string;
      marks: number;
      options: string[];
      Answer: string;
    }>;
  };
  createdAt: string;
}

const maskEnrollment = (enrollment: number | undefined) => {
  const num = String(enrollment || 0);
  if (num.length > 5) {
    return num.slice(0, -5) + '*****';
  }
  return num || 'N/A';
};

const SubjectUpload = () => {
  // State
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [subjectUploads, setSubjectUploads] = useState<ProcessedUpload[]>([]);
  const [expandedUploadId, setExpandedUploadId] = useState<string | null>(null);

  // New subject dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectDesc, setNewSubjectDesc] = useState('');
  const [isCreatingSubject, setIsCreatingSubject] = useState(false);
  const [addAllToBank, setAddAllToBank] = useState(true); // Add all questions to bank by default
  const [extractorAPI, setExtractorAPI] = useState<'landing' | 'gemini' | 'groq'>('groq'); // API selection - default to Groq (free)

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch subjects on mount
  useEffect(() => {
    fetchSubjects();
  }, []);

  // Fetch uploads when subject changes
  useEffect(() => {
    if (selectedSubject) {
      fetchSubjectUploads(selectedSubject._id);
    }
  }, [selectedSubject]);

  const fetchSubjects = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/subjects`);
      setSubjects(response.data.data || []);
    } catch (error) {
      console.error("Error fetching subjects:", error);
      setStatusMessage({ type: 'error', text: 'Failed to load subjects' });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSubjectUploads = async (subjectId: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/subjects/${subjectId}/uploads`);
      setSubjectUploads(response.data.data || []);
    } catch (error) {
      console.error("Error fetching uploads:", error);
    }
  };

  const handleCreateSubject = async () => {
    if (!newSubjectName.trim()) {
      return;
    }

    setIsCreatingSubject(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/subjects`, {
        name: newSubjectName,
        description: newSubjectDesc
      });

      if (response.data.success) {
        setSubjects([...subjects, response.data.data]);
        setNewSubjectName('');
        setNewSubjectDesc('');
        setIsDialogOpen(false);
        setStatusMessage({ type: 'success', text: `Subject "${response.data.data.name}" created!` });
      }
    } catch (error: any) {
      setStatusMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to create subject'
      });
    } finally {
      setIsCreatingSubject(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string, subjectName: string) => {
    if (!confirm(`Delete subject "${subjectName}" and all its uploads?`)) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/subjects/${subjectId}`);
      setSubjects(subjects.filter(s => s._id !== subjectId));
      if (selectedSubject?._id === subjectId) {
        setSelectedSubject(null);
        setSubjectUploads([]);
      }
      setStatusMessage({ type: 'success', text: `Subject "${subjectName}" deleted` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: 'Failed to delete subject' });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage({ type: '', text: '' });
    setUploadResults([]);
    const filesArray = Array.from(e.target.files || []);
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    const validFiles = filesArray.filter((file) => allowedTypes.includes(file.type));

    if (validFiles.length !== filesArray.length) {
      setStatusMessage({ type: 'warning', text: "Some files ignored (only PDF, JPG, PNG allowed)" });
    }
    setSelectedFiles(validFiles);
  };

  const handleUpload = async () => {
    if (!selectedSubject || selectedFiles.length === 0) {
      setStatusMessage({ type: 'error', text: "Select a subject and files first" });
      return;
    }

    setIsProcessing(true);
    const apiName = extractorAPI === 'groq' ? 'Groq Vision' : extractorAPI === 'gemini' ? 'Google Gemini' : 'Landing AI';
    setStatusMessage({ type: 'info', text: `Processing ${selectedFiles.length} files with ${apiName}...` });
    setUploadResults([]);

    const formData = new FormData();
    selectedFiles.forEach((file) => {
      formData.append("files", file);
    });
    formData.append("addAllToBank", String(addAllToBank));
    formData.append("extractorAPI", extractorAPI);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/subjects/${selectedSubject._id}/upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' }
        }
      );

      const result = response.data;
      const statsText = result.stats?.questionsAdded > 0
        ? ` (${result.stats.questionsAdded} questions added to Question Bank)`
        : '';
      setStatusMessage({
        type: 'success',
        text: (result.message || `Processed ${result.stats?.success} files`) + statsText
      });
      setUploadResults(result.results || []);

      // Refresh data
      fetchSubjects();
      fetchSubjectUploads(selectedSubject._id);

      // Clear files
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

    } catch (error: any) {
      setStatusMessage({
        type: 'error',
        text: error.response?.data?.error || "Upload failed"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleQuestionsView = (uploadId: string) => {
    setExpandedUploadId(prev => prev === uploadId ? null : uploadId);
  };

  const getStatusIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'info':
      case 'warning': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <FileText className="h-4 w-4 text-gray-400" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <BookOpen className="h-8 w-8" />
          Subject-wise Upload
        </h1>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="h-4 w-4 mr-2" />
              New Subject
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Subject</DialogTitle>
              <DialogDescription>
                Add a new subject for organizing your question uploads.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="subject-name">Subject Name</Label>
                <Input
                  id="subject-name"
                  placeholder="e.g., Data Structures"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="subject-desc">Description (Optional)</Label>
                <Input
                  id="subject-desc"
                  placeholder="Brief description..."
                  value={newSubjectDesc}
                  onChange={(e) => setNewSubjectDesc(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSubject}
                disabled={!newSubjectName.trim() || isCreatingSubject}
              >
                {isCreatingSubject ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Create Subject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subject List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Subjects ({subjects.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subjects.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  No subjects yet. Create one to get started!
                </p>
              ) : (
                <div className="space-y-2">
                  {subjects.map((subject) => (
                    <div
                      key={subject._id}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedSubject?._id === subject._id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedSubject(subject)}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold">{subject.name}</h3>
                          <p className="text-sm text-gray-500">
                            {subject.totalUploads} uploads | {subject.totalQuestions} questions
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSubject(subject._id, subject.name);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upload Section */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadIcon className="h-5 w-5" />
                Upload Files
                {selectedSubject && (
                  <span className="text-indigo-600 ml-2">- {selectedSubject.name}</span>
                )}
              </CardTitle>
              <CardDescription>
                Select a subject and upload PDF, JPG, or PNG files for AI-powered extraction
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!selectedSubject ? (
                <div className="text-center py-8 text-gray-500">
                  <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>Select a subject from the list to upload files</p>
                </div>
              ) : (
                <>
                  {/* File Input */}
                  <div>
                    <Label htmlFor="files" className="font-semibold">Select Files</Label>
                    <Input
                      ref={fileInputRef}
                      id="files"
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleFileChange}
                      className="mt-2"
                    />
                    {selectedFiles.length > 0 && (
                      <p className="text-sm text-gray-600 mt-1">
                        {selectedFiles.length} file(s) selected
                      </p>
                    )}
                  </div>

                  {/* API Selection */}
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <Label className="font-semibold mb-3 block">Choose Extraction API</Label>
                    <RadioGroup
                      value={extractorAPI}
                      onValueChange={(value) => setExtractorAPI(value as 'landing' | 'gemini' | 'groq')}
                      className="flex flex-col sm:flex-row gap-4 flex-wrap"
                    >
                      <div className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        extractorAPI === 'groq' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <RadioGroupItem value="groq" id="groq" />
                        <Label htmlFor="groq" className="cursor-pointer flex-1">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-green-600" />
                            <span className="font-semibold">Groq Vision</span>
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Recommended</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Free (~80 PDFs/day)</p>
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        extractorAPI === 'landing' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <RadioGroupItem value="landing" id="landing" />
                        <Label htmlFor="landing" className="cursor-pointer flex-1">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-blue-600" />
                            <span className="font-semibold">Landing AI</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Premium API (Paid)</p>
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        extractorAPI === 'gemini' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <RadioGroupItem value="gemini" id="gemini" />
                        <Label htmlFor="gemini" className="cursor-pointer flex-1">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-purple-600" />
                            <span className="font-semibold">Google Gemini</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Free tier (1500/day)</p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Add to Question Bank Option */}
                  <div className="flex items-center space-x-3 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                    <Checkbox
                      id="addToBank"
                      checked={addAllToBank}
                      onCheckedChange={(checked) => setAddAllToBank(checked === true)}
                    />
                    <div className="flex-1">
                      <Label htmlFor="addToBank" className="font-semibold flex items-center gap-2 cursor-pointer">
                        <Library className="h-4 w-4 text-indigo-600" />
                        Add all questions to Question Bank
                      </Label>
                      <p className="text-sm text-gray-600 mt-1">
                        {addAllToBank
                          ? "All extracted questions will be added to the question bank for this subject"
                          : "Only answer key files (enrollment 0) will be added to the question bank"
                        }
                      </p>
                    </div>
                  </div>

                  {/* Status Message */}
                  {statusMessage.text && (
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                      statusMessage.type === 'success' ? 'bg-green-100 text-green-700' :
                      statusMessage.type === 'error' ? 'bg-red-100 text-red-700' :
                      statusMessage.type === 'info' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {getStatusIcon(statusMessage.type)}
                      <span>{statusMessage.text}</span>
                    </div>
                  )}

                  {/* Upload Button */}
                  <Button
                    onClick={handleUpload}
                    disabled={selectedFiles.length === 0 || isProcessing}
                    className={`w-full ${
                      extractorAPI === 'groq' ? 'bg-green-600 hover:bg-green-700' :
                      extractorAPI === 'gemini' ? 'bg-purple-600 hover:bg-purple-700' :
                      'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing with {extractorAPI === 'groq' ? 'Groq Vision' : extractorAPI === 'gemini' ? 'Gemini' : 'Landing AI'}...
                      </>
                    ) : (
                      <>
                        {extractorAPI === 'groq' ? <Zap className="mr-2 h-4 w-4" /> : extractorAPI === 'gemini' ? <Sparkles className="mr-2 h-4 w-4" /> : <Zap className="mr-2 h-4 w-4" />}
                        Upload & Process with {extractorAPI === 'groq' ? 'Groq Vision' : extractorAPI === 'gemini' ? 'Gemini' : 'Landing AI'}
                      </>
                    )}
                  </Button>

                  {/* Upload Results */}
                  {uploadResults.length > 0 && (
                    <div className="mt-6">
                      <h3 className="font-semibold mb-3">Upload Results</h3>
                      <div className="space-y-2">
                        {uploadResults.map((result, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${
                              result.status === 'success'
                                ? 'border-green-200 bg-green-50'
                                : 'border-red-200 bg-red-50'
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-medium">{result.fileName}</span>
                              {result.status === 'success' ? (
                                <span className="text-green-600 flex items-center gap-1">
                                  <CheckCircle className="h-4 w-4" />
                                  {result.questionCount} questions
                                </span>
                              ) : (
                                <span className="text-red-600 flex items-center gap-1">
                                  <XCircle className="h-4 w-4" />
                                  Failed
                                </span>
                              )}
                            </div>
                            {result.error && (
                              <p className="text-sm text-red-600 mt-1">{result.error}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Previous Uploads */}
          {selectedSubject && subjectUploads.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Previous Uploads ({subjectUploads.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enrollment</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {subjectUploads.map((upload) => (
                        <React.Fragment key={upload._id}>
                          <tr>
                            <td className="px-4 py-3 text-sm font-medium">{upload.originalName}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {maskEnrollment(upload.extractedData?.documentInfo?.enrollmentNumber)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">{upload.questionCount}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 text-xs rounded-full ${
                                upload.status === 'completed'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {upload.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {upload.questionCount > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleQuestionsView(upload._id)}
                                >
                                  {expandedUploadId === upload._id ? (
                                    <EyeOff className="h-4 w-4 mr-1" />
                                  ) : (
                                    <Eye className="h-4 w-4 mr-1" />
                                  )}
                                  {expandedUploadId === upload._id ? 'Hide' : 'View'}
                                </Button>
                              )}
                            </td>
                          </tr>
                          {expandedUploadId === upload._id && (
                            <tr>
                              <td colSpan={5} className="p-4 bg-gray-50">
                                <div className="mb-3">
                                  <QuestionTypeSummary questions={upload.extractedData?.questions || []} />
                                </div>
                                <div className="space-y-2">
                                  {upload.extractedData?.questions?.map((q, idx) => (
                                    <QuestionDisplay
                                      key={idx}
                                      question={q}
                                      index={idx}
                                      showAnswer={true}
                                    />
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubjectUpload;
