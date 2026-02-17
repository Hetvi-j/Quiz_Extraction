# Diagram Detection & Storage Integration Guide

## 📋 Overview

Your system can now **detect, extract, and store diagrams** from uploaded documents. Diagrams are stored as compressed base64 in MongoDB alongside extracted text/questions.

---

## 🛠️ What's New

### New Files Created:
1. **`Server/utils/diagramExtractor.js`** — Diagram detection & extraction logic
   - Uses Groq Vision LLM to identify diagrams
   - Fallback: Visual analysis (edge detection)
   - Extracts diagram regions as PNG images
   - Converts to base64

2. **`Server/models/UploadWithDiagram.js`** — MongoDB schema with diagram support
   - Stores diagrams array with metadata
   - Tracks diagram statistics (types, confidence, count)
   - Indexes for fast querying

3. **`Server/controllers/diagramController.js`** — Diagram operations
   - `processDiagramsFromImage()` — Extract diagrams from image buffer
   - `saveUploadWithDiagrams()` — Save to MongoDB
   - `getDiagramsByUploadId()` — Retrieve all diagrams
   - `getDiagramsByType()` — Filter by diagram type
   - `searchDiagrams()` — Global search across all uploads

4. **`Server/routes/diagramRoutes.js`** — REST API endpoints
   - `GET /api/v1/diagrams/:uploadId` — Get all diagrams from an upload
   - `GET /api/v1/diagrams/:uploadId/:diagramId` — Get specific diagram image
   - `GET /api/v1/diagrams/type/:type` — Search by type
   - `GET /api/v1/diagrams/search` — Advanced filtering

---

## ✅ Integration Steps

### Step 1: Install Dependencies
```bash
npm install sharp axios
```

**Required packages:**
- `sharp` — Image processing (detecting diagrams)
- `axios` — HTTP requests (Groq Vision API)

### Step 2: Update `server.js` to Register Routes
```javascript
// Add to server.js imports:
import diagramRoutes from './routes/diagramRoutes.js';

// Add to route registrations:
app.use('/api/v1/diagrams', diagramRoutes);
```

### Step 3: Integrate into Upload Controller
Update your existing upload controller to call diagram extraction:

```javascript
// In your uploadController.js or subjectUploadController.js

import { processDiagramsFromImage, saveUploadWithDiagrams } from '../controllers/diagramController.js';
import { UploadWithDiagram } from '../models/UploadWithDiagram.js';

// When processing a PDF/image:
export async function handleFileUpload(file) {
  // Your existing OCR/text extraction code...
  const imageBuffer = fs.readFileSync(file.path);
  const textData = await extractTextWithOCR(imageBuffer);
  
  // 🆕 Extract diagrams
  const { diagrams, stats } = await processDiagramsFromImage(imageBuffer, pageNumber);
  
  // Save with diagrams
  const upload = await saveUploadWithDiagrams(
    {
      subjectId: subjectId,
      subjectName: subjectName,
      filename: file.filename,
      originalName: file.originalname,
      fileType: file.mimetype.split('/')[1],
      fileSize: file.size,
      questionCount: textData.questions.length,
      extractedData: textData
    },
    diagrams
  );
  
  return upload;
}
```

### Step 4: (Optional) Add to Your Paper Model
If you want to store diagrams directly in student submissions:

```javascript
// In your Paper.js or Result.js model:
const studentResponseSchema = new mongoose.Schema({
  enrollmentNumber: String,
  fileName: String,
  questions: [...],
  diagrams: [{  // 🆕 New
    pageNumber: Number,
    diagramType: String,
    base64Image: String,
    confidence: Number
  }],
  submittedAt: { type: Date, default: Date.now }
});
```

---

## 📊 Database Schema

### Diagram Storage Structure
```javascript
{
  _id: ObjectId,
  diagramIndex: 1,
  pageNumber: 1,
  type: "flowchart",                    // flowchart, circuit, graph, mathematical, anatomical, other
  location: "top-center",               // Verbal description
  confidence: 0.92,                     // 0-1 confidence score
  image: {
    base64: "iVBORw0KGgoAAAANS...",  // Compressed base64 PNG
    mimeType: "image/png",
    size: 45230                         // Size in bytes
  },
  coordinates: {
    x: 10,                              // Percentage coordinates (0-100)
    y: 20,
    width: 50,
    height: 40
  },
  detectedAt: "2025-02-16T10:30:00Z"
}
```

### Statistics Tracked
```javascript
diagramStats: {
  totalDiagramsFound: 5,
  diagramsStored: 5,
  types: {
    flowchart: 2,
    circuit: 1,
    graph: 2,
    mathematical: 0,
    anatomical: 0,
    other: 0
  },
  averageConfidence: 0.87
}
```

---

## 🔍 Detection Methods

### Method 1: LLM Vision (Recommended) ✨
- Uses **Groq Vision API** (free tier: 7,000 images/day)
- Identifies diagram types accurately
- Handles complex diagrams well
- Requires GROQ_API_KEY (already set in your `.env`)

**Detected Types:**
- Flowcharts & decision diagrams
- Circuit diagrams
- Graphs & charts
- Mathematical diagrams
- Anatomical illustrations
- Structured visual content

### Method 2: Visual Analysis (Fallback)
- When Groq API unavailable
- Detects high-contrast regions
- Grid-based edge density analysis
- Works offline, no API needed

---

## 📡 API Usage Examples

### Get All Diagrams from Upload
```bash
curl http://localhost:8080/api/v1/diagrams/507f1f77bcf86cd799439011
```

**Response:**
```json
{
  "success": true,
  "data": {
    "uploadName": "physics_paper_1.pdf",
    "totalDiagrams": 3,
    "diagrams": [
      {
        "_id": "507f1f77bcf86cd799439012",
        "type": "circuit",
        "confidence": 0.95,
        "pageNumber": 2,
        "coordinates": { "x": 10, "y": 20, "width": 50, "height": 40 }
      }
    ],
    "stats": { "totalDiagramsFound": 3, "types": { "circuit": 1, "graph": 2 } }
  }
}
```

### Get Diagram Image (Base64)
```bash
curl http://localhost:8080/api/v1/diagrams/507f1f77bcf86cd799439011/507f1f77bcf86cd799439012
```

**Response:**
```json
{
  "success": true,
  "data": {
    "base64": "iVBORw0KGgoAAAANSUhEUgAA...",
    "mimeType": "image/png",
    "type": "circuit",
    "coordinates": { "x": 10, "y": 20, "width": 50, "height": 40 }
  }
}
```

### Search All Flowcharts
```bash
curl "http://localhost:8080/api/v1/diagrams/type/flowchart"
```

### Advanced Search with Filters
```bash
curl "http://localhost:8080/api/v1/diagrams/search?type=circuit&minConfidence=0.85"
```

---

## 💾 Storage Optimization

### Base64 Size Consideration
- Average diagram size: 30-100 KB (base64)
- 1,000 diagrams ≈ 30-100 MB storage
- MongoDB document limit: 16 MB (use pagination if needed)

### For Large-Scale Storage
If you have thousands of diagrams, store file path instead:

```javascript
'image': {
  base64: undefined,  // Skip
  fileReference: 's3://bucket/diagram_001.png'  // Store path instead
}
```

---

## 🎯 Use Cases

✅ **Student Papers**
- Detect & store student-drawn diagrams
- Later retrieve for re-evaluation
- Compare diagram quality between students

✅ **Research & Analysis**
- Build diagram library indexed by type
- Search flowcharts across all papers in a subject
- Track diagram complexity trends

✅ **Educational Content**
- Create diagram galleries
- Tag and categorize diagrams
- Reuse diagrams in study materials

✅ **Quality Control**
- Verify papers contain required diagrams
- Check diagram types match question requirements

---

## 🐛 Debugging

### Enable Debug Logging
Add this to check diagram detection:

```javascript
console.log(`Found ${diagrams.length} diagrams`);
console.log('Diagram types:', diagrams.map(d => d.type));
console.log('Confidence scores:', diagrams.map(d => d.confidence));
```

### Test Detection
```bash
# Test diagram extraction directly
node -e "
import { extractAllDiagrams } from './utils/diagramExtractor.js';
import fs from 'fs';

const img = fs.readFileSync('./test_image.png');
const result = await extractAllDiagrams(img, 1);
console.log(result);
"
```

### Check MongoDB Storage
```bash
# View diagrams in MongoDB
db.uploadswitdiagrams.findOne({}, { diagrams: 1, diagramStats: 1 })
```

---

## 📝 Next Steps

1. **Install deps**: `npm install sharp axios`
2. **Update server.js**: Register diagram routes
3. **Test extraction**: Call `/api/v1/diagrams/:uploadId`
4. **Build UI**: Display diagram gallery in React
5. **Expand use cases**: Categorize, tag, search diagrams

---

## ⚠️ Important Notes

- **GROQ_API_KEY** must be set in `.env` for LLM-based detection
- Diagrams stored as **compressed base64 PNG** in MongoDB
- Detection works on **images and PDF pages** (converted to images first)
- Diagram type detection is **best-effort** (confidence scores provided)

---

## 📞 Questions?

Check logs for detailed detection output:
```
🔍 Processing diagrams from page 1...
📊 Found 2 diagram(s) on page 1
  ✅ Extracted diagram 1: flowchart (confidence: 0.92)
  ✅ Extracted diagram 2: graph (confidence: 0.87)
📊 Diagram Statistics:
   Total diagrams: 2
   By type: {"flowchart":1,"graph":1}
   Avg confidence: 0.90
```

This gives you full visibility into what your system detected and stored!
