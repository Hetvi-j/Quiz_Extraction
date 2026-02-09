import React, { useState, useRef } from "react"; 
import axios from "axios";
// Shadcn UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// Icons for status visualization
import { Upload as UploadIcon, FileText, Image as ImageIcon, Loader2, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";

// 📌 NEW API Endpoint for Client-Side Upload (You must create this route in your backend)
const API_UPLOAD_URL = "http://localhost:8080/api/v1/quiz/extract-folder";

const maskEnrollment = (enrollment) => {
    const num = String(enrollment);
    if (num.length > 5) {
      return num.slice(0, -5) + '*****';
    }
    return num || 'N/A';
};

const UploadProcessor = () => {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [subject, setSubject] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
    const [processedQuizzes, setProcessedQuizzes] = useState([]);
    const [expandedQuizId, setExpandedQuizId] = useState(null);

    const fileInputRef = useRef(null); 

    const handleFileChange = (e) => {
        setStatusMessage({ type: '', text: '' });
        setProcessedQuizzes([]);
        const filesArray = Array.from(e.target.files);
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        const validFiles = filesArray.filter((file) => allowedTypes.includes(file.type));
        
        if (validFiles.length !== filesArray.length) {
             setStatusMessage({ type: 'warning', text: "Warning: Only PDF, JPG, and PNG files are processed (others ignored)." });
        }
        setSelectedFiles(validFiles);
    };

    const toggleQuestionsView = (quizId) => {
        setExpandedQuizId(prevId => prevId === quizId ? null : quizId);
    };

    const handleUpload = async () => {
        if (selectedFiles.length === 0 || !subject) {
            setStatusMessage({ type: 'error', text: "Please select files and a subject before processing." });
            return;
        }

        setIsProcessing(true);
        setStatusMessage({ type: 'info', text: `Uploading ${selectedFiles.length} files and starting extraction...` });
        setProcessedQuizzes([]);
        setExpandedQuizId(null);

        const formData = new FormData();
        formData.append("subject", subject);
        
        selectedFiles.forEach((file) => {
             // Append file using its relative path in the folder
             formData.append("files", file, file.webkitRelativePath || file.name); 
        });

        try {
             // Use axios to post the FormData
             const response = await axios.post(API_UPLOAD_URL, formData, {
                 headers: {
                     'Content-Type': 'multipart/form-data',
                 }
             });

            const result = response.data;
            
            setStatusMessage({ 
                type: 'success', 
                text: result.message || `Successfully processed ${result.processed_count} file(s).` 
            });
            setProcessedQuizzes(result.data || []);
            
            // Clear the input after successful upload
            setSelectedFiles([]); 
            if (fileInputRef.current) {
                fileInputRef.current.value = ""; 
            }

        } catch (error) {
            const displayMessage = error.response?.data?.error || 
                                   error.message.includes('404') ? 
                                   "Server Error: Check if the backend is running and the /upload-and-process route is defined." :
                                   "Network Error: Could not connect to the backend server.";

            setStatusMessage({ 
                type: 'error', 
                text: displayMessage
            });
            console.error("Upload/Processing Error:", error.response?.data || error);

        } finally {
            setIsProcessing(false);
        }
    };
    
    // Utility function to determine status icon and color
    const getStatusIcon = (type) => {
        switch (type) {
          case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
          case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
          case 'info':
          case 'warning': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
          default: return <FileText className="h-4 w-4 text-gray-400" />;
        }
      };

    return (
        // 1. Centering the entire component
        <div className="flex justify-center w-full my-10">
            <Card className="w-[800px] shadow-lg">
                <CardHeader>
                    <CardTitle className="flex items-center text-2xl">
                        {getStatusIcon(statusMessage.type)} Quiz Folder Upload & Processor
                    </CardTitle>
                    <CardDescription>
                        Select a **folder** from your local computer to upload and automatically extract quiz data.
                    </CardDescription>
                </CardHeader>
                
                <CardContent className="space-y-6">
                    
                    {/* File Input */}
                    <div>
                        <Label htmlFor="files" className="font-semibold text-gray-700">Select Quiz Folder</Label>
                        <Input
                            ref={fileInputRef} 
                            id="files"
                            type="file"
                            multiple
                            // This attribute enables folder selection in most modern browsers
                            // @ts-ignore
                            webkitdirectory="" 
                            directory=""
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={handleFileChange}
                            className="mt-2 p-2 border-dashed border-gray-400 focus:ring-indigo-500"
                        />
                    </div>

                    {/* Subject Select */}
                    <div>
                        <Label htmlFor="subject" className="font-semibold text-gray-700">Subject</Label>
                        <Select value={subject} onValueChange={setSubject} disabled={isProcessing}>
                            <SelectTrigger className="mt-2 w-full">
                                <SelectValue placeholder="Select subject" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DSA">Data Structure And Algoritm</SelectItem>
                                <SelectItem value="MC">Mobile Computing</SelectItem>
                                <SelectItem value="chemistry">Chemistry</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Status and Action */}
                    <div className="space-y-4">
                        <p className={`flex items-center p-3 rounded-lg text-sm font-medium ${
                            statusMessage.type === 'success' ? 'bg-green-100 text-green-700' :
                            statusMessage.type === 'error' ? 'bg-red-100 text-red-700' :
                            statusMessage.type === 'info' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                        }`}>
                            {getStatusIcon(statusMessage.type)}
                            <span>{statusMessage.text || "Waiting for files and subject selection."}</span>
                        </p>
                        
                        <Button 
                            onClick={handleUpload} 
                            disabled={selectedFiles.length === 0 || !subject || isProcessing}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition duration-150 ease-in-out"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Processing {selectedFiles.length} file(s)...
                                </>
                            ) : (
                                <>
                                    <UploadIcon className="mr-2 h-4 w-4" />
                                    Upload & Process Folder
                                </>
                            )}
                        </Button>
                    </div>
                    
                    {/* Processed Results Summary Table */}
                    {processedQuizzes.length > 0 && (
                        <div className="mt-8">
                            <h3 className="text-lg font-semibold mb-3">
                                Processed Results Summary ({processedQuizzes.length} Quizzes)
                            </h3>
                            
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200 border rounded-lg">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enrollment No.</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Questions</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {processedQuizzes.map((quiz, index) => (
                                            <React.Fragment key={quiz._id || index}>
                                                <tr>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{quiz.file_name}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {maskEnrollment(quiz.documentInfo.enrollmentNumber)}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{quiz.documentInfo.date || 'N/A'}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{quiz.questions.length}</td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {quiz.questions.length > 0 && (
                                                            <Button 
                                                                variant="outline" 
                                                                size="sm"
                                                                onClick={() => toggleQuestionsView(quiz._id || index)}
                                                                className="h-7"
                                                            >
                                                                {expandedQuizId === (quiz._id || index) ? (
                                                                    <EyeOff className="h-4 w-4 mr-1" />
                                                                ) : (
                                                                    <Eye className="h-4 w-4 mr-1" />
                                                                )}
                                                                {expandedQuizId === (quiz._id || index) ? 'Hide' : 'View'}
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                                {/* Detail Row for Questions */}
                                                {expandedQuizId === (quiz._id || index) && (
                                                    <tr>
                                                        <td colSpan={5} className="p-4 bg-gray-50/70 border-t border-gray-200">
                                                            <h4 className="text-md font-semibold mb-2">Questions for {quiz.file_name}:</h4>
                                                            <ul className="list-decimal list-inside space-y-3">
                                                                {quiz.questions.map((q, qIndex) => (
                                                                    <li key={qIndex} className="text-sm">
                                                                        <p className="font-medium">{q.questionText}</p>
                                                                        <p className="ml-5 text-gray-600">
                                                                            <span className="font-semibold text-green-700">Correct Answer(s):</span> {q.Answer || 'N/A'} 
                                                                        </p>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default UploadProcessor;


// import React, { useState } from "react";
// import axios from "axios";
// // Shadcn UI Components
// import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import { Loader2, CheckCircle, XCircle, FileText, Upload as UploadIcon, Eye, EyeOff } from "lucide-react";

// // 📌 API Endpoint for the Node.js Backend (Ensure this is correct)
// const API_UPLOAD_URL = "http://localhost:8080/api/v1/quiz/extract-folder";

// // --- Initial State ---
// const INITIAL_STATE = {
//   message: "Ready to process files in the server's 'uploads' folder.",
//   filesProcessed: 0,
//   totalFiles: 0,
//   data: [], // Stores the array of extracted quiz objects
//   status: 'idle', // 'idle' | 'loading' | 'success' | 'error'
// };

// const FolderExtractorCard = () => {
//   const [state, setState] = useState(INITIAL_STATE);
//   const { message, status, data, filesProcessed, totalFiles } = state;
//   const [expandedQuizId, setExpandedQuizId] = useState(null); // State for the expanded question view

//   /** Helper to mask the last 5 digits of the enrollment number. */
//   const maskEnrollment = (enrollment) => {
//     const num = String(enrollment);
//     if (num.length > 5) {
//       return num.slice(0, -5) + '*****';
//     }
//     return num; // Or '*****' if it's shorter/invalid
//   };

//   /** Toggles the detailed question view for a specific quiz ID. */
//   const toggleQuestionsView = (quizId) => {
//     setExpandedQuizId(prevId => prevId === quizId ? null : quizId);
//   };
  
//   /** Fetches the appropriate icon based on the current processing status. */
//   const getStatusIcon = () => {
//     switch (status) {
//       case 'loading':
//         return <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-500" />;
//       case 'success':
//         return <CheckCircle className="mr-2 h-4 w-4 text-green-500" />;
//       case 'error':
//         return <XCircle className="mr-2 h-4 w-4 text-red-500" />;
//       default:
//         return <FileText className="mr-2 h-4 w-4 text-gray-400" />;
//     }
//   };

//   /** Handles the API call to trigger the backend folder processing. */
//   const handleProcessFolder = async () => {
//     setState(s => ({ ...s, status: 'loading', message: "Connecting to server and starting file processing..." }));

//     try {
//       const response = await axios.post(API_UPLOAD_URL);
      
//       const { message, processed_count, total_files_found, data } = response.data;
      
//       setState({
//         status: 'success',
//         message: message || "Extraction completed successfully.",
//         filesProcessed: processed_count,
//         totalFiles: total_files_found,
//         data: data,
//       });
//       setExpandedQuizId(null); // Collapse any open question lists

//     } catch (err) {
//       const errorMsg = err.response?.data?.error || err.message;
//       console.error("Extraction Error:", err.response?.data || err);

//       setState(s => ({
//         ...s,
//         status: 'error',
//         message: `Processing failed. Error: ${errorMsg}`,
//       }));
//     }
//   };

//   return (
//     // 2. Centering the entire component
//     <div className="flex justify-center w-full my-10">
//       <Card className="w-[800px] shadow-lg">
//         <CardHeader>
//           <CardTitle className="flex items-center text-2xl">
//             {getStatusIcon()} Quiz Folder Extractor
//           </CardTitle>
//           <CardDescription>
//             Triggers the server's API to process all `.pdf`, `.jpg`, and `.png` files found in the backend's designated **`uploads`** folder.
//           </CardDescription>
//         </CardHeader>
        
//         <CardContent>
//           {/* Processing Action */}
//           <div className="flex flex-col items-center justify-between space-y-4 border p-6 rounded-lg bg-gray-50">
//             <p className="text-sm font-medium text-gray-700">
//               **Backend Path:** <code className="bg-gray-200 p-1 rounded">server/uploads/</code>
//             </p>
            
//             <Button 
//               onClick={handleProcessFolder} 
//               disabled={status === 'loading'}
//               className="w-full sm:w-auto px-10"
//             >
//               {status === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
//               {status !== 'loading' && <UploadIcon className="mr-2 h-4 w-4" />}
//               {status === 'loading' ? 'Processing...' : 'Process Uploads Folder'}
//             </Button>
//           </div>

//           <div className="mt-6">
//             <h3 className="text-lg font-semibold mb-2">Current Status</h3>
//             <p className={`p-3 rounded-lg text-sm ${
//               status === 'success' ? 'bg-green-100 text-green-800' :
//               status === 'error' ? 'bg-red-100 text-red-800' :
//               status === 'loading' ? 'bg-blue-100 text-blue-800' :
//               'bg-gray-100 text-gray-600'
//             }`}>
//               {message}
//             </p>
//           </div>

//           {/* Results Summary Table */}
//           {status === 'success' && totalFiles > 0 && (
//             <div className="mt-8">
//               <h3 className="text-lg font-semibold mb-3">
//                   Processed Results Summary ({filesProcessed} / {totalFiles})
//               </h3>
              
//               <div className="overflow-x-auto">
//                 <table className="min-w-full divide-y divide-gray-200 border rounded-lg">
//                   <thead className="bg-gray-50">
//                     <tr>
//                       <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
//                       <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Enrollment No.</th>
//                       <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
//                       <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Questions</th>
//                       <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
//                     </tr>
//                   </thead>
//                   <tbody className="bg-white divide-y divide-gray-200">
//                     {data.map((quiz, index) => (
//                       <React.Fragment key={quiz._id || index}>
//                         <tr>
//                           <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{quiz.file_name}</td>
//                           {/* 3. Enrollment Masking */}
//                           <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
//                             {maskEnrollment(quiz.documentInfo.enrollmentNumber)}
//                           </td>
//                           <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{quiz.documentInfo.date || 'N/A'}</td>
//                           <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{quiz.questions.length}</td>
//                           <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
//                             {/* 4. View Questions Button */}
//                             {quiz.questions.length > 0 && (
//                                 <Button 
//                                     variant="outline" 
//                                     size="sm"
//                                     onClick={() => toggleQuestionsView(quiz._id)}
//                                     className="h-7"
//                                 >
//                                     {expandedQuizId === quiz._id ? (
//                                         <EyeOff className="h-4 w-4 mr-1" />
//                                     ) : (
//                                         <Eye className="h-4 w-4 mr-1" />
//                                     )}
//                                     {expandedQuizId === quiz._id ? 'Hide' : 'View'}
//                                 </Button>
//                             )}
//                           </td>
//                         </tr>
//                         {/* Detail Row for Questions */}
//                         {expandedQuizId === quiz._id && (
//                           <tr>
//                             <td colSpan={5} className="p-4 bg-gray-50/70 border-t border-gray-200">
//                                 <h4 className="text-md font-semibold mb-2">Questions for {quiz.file_name}:</h4>
//                                 <ul className="list-decimal list-inside space-y-3">
//                                     {quiz.questions.map((q, qIndex) => (
//                                         <li key={qIndex} className="text-sm">
//                                             <p className="font-medium">{q.questionText}</p>
//                                             <p className="ml-5 text-gray-600">
//                                                 <span className="font-semibold text-green-700">Correct Answer(s):</span> {q.Answer || 'N/A'} 
//                                             </p>
//                                         </li>
//                                     ))}
//                                 </ul>
//                             </td>
//                           </tr>
//                         )}
//                       </React.Fragment>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             </div>
//           )}
//         </CardContent>
//       </Card>
//     </div>
//   );
// };

// export default FolderExtractorCard;
