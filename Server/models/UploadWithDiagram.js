import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Schema for storing extracted diagram data
 */
const diagramSchema = new Schema({
  pageNumber: {
    type: Number,
    required: true,
    description: "Which page of the document"
  },
  diagramIndex: {
    type: Number,
    required: true,
    description: "Diagram number on the page"
  },
  type: {
    type: String,
    enum: ['flowchart', 'circuit', 'graph', 'mathematical', 'anatomical', 'structured_region', 'other'],
    default: 'other',
    description: "Type of diagram detected"
  },
  location: {
    type: String,
    description: "Description of diagram location (e.g., 'top-left', 'center')"
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.7,
    description: "Confidence score of diagram detection (0-1)"
  },
  
  // The actual diagram image
  image: {
    base64: {
      type: String,
      description: "Base64 encoded diagram image (PNG)"
    },
    mimeType: {
      type: String,
      default: 'image/png'
    },
    size: {
      type: Number,
      description: "Image size in bytes"
    },
    // Optional: Store as a file reference instead of base64 for large images
    fileReference: {
      type: String,
      description: "Path or S3 URL if stored externally"
    }
  },
  
  // Bounding box coordinates (percentage of page)
  coordinates: {
    x: { type: Number, min: 0, max: 100 },
    y: { type: Number, min: 0, max: 100 },
    width: { type: Number, min: 0, max: 100 },
    height: { type: Number, min: 0, max: 100 }
  },
  
  // Optional: OCR/LLM analysis of diagram
  analysis: {
    description: String,
    labels: [String],  // "Flow arrows", "Decision boxes", etc.
    text: [String]     // Any text found in diagram
  },
  
  detectedAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Extended Upload schema with diagram support
 */
const uploadWithDiagramSchema = new Schema({
  subjectId: {
    type: Schema.Types.ObjectId,
    ref: 'Subject',
    required: true,
    index: true
  },
  subjectName: {
    type: String,
    required: true,
    uppercase: true
  },
  filename: {
    type: String,
    required: true,
    trim: true
  },
  originalName: {
    type: String,
    trim: true
  },
  fileType: {
    type: String,
    enum: ['pdf', 'jpg', 'jpeg', 'png'],
    lowercase: true
  },
  fileSize: {
    type: Number,
    default: 0
  },
  questionCount: {
    type: Number,
    default: 0
  },
  
  extractedData: {
    documentInfo: {
      enrollmentNumber: Number,
      date: String,
      totalMarks: Number
    },
    questions: [{
      questionText: String,
      questionType: String,
      marks: Number,
      options: [String],
      Answer: String
    }]
  },
  
  // ✅ NEW: Store all detected diagrams
  diagrams: [diagramSchema],
  
  // Diagram statistics
  diagramStats: {
    totalDiagramsFound: {
      type: Number,
      default: 0
    },
    diagramsStored: {
      type: Number,
      default: 0
    },
    types: {
      flowchart: { type: Number, default: 0 },
      circuit: { type: Number, default: 0 },
      graph: { type: Number, default: 0 },
      mathematical: { type: Number, default: 0 },
      anatomical: { type: Number, default: 0 },
      other: { type: Number, default: 0 }
    },
    averageConfidence: {
      type: Number,
      default: 0
    }
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for querying diagrams
uploadWithDiagramSchema.index({ 'diagrams.type': 1 });
uploadWithDiagramSchema.index({ 'diagrams.pageNumber': 1 });

const UploadWithDiagram = mongoose.model('UploadWithDiagram', uploadWithDiagramSchema);

export { UploadWithDiagram, diagramSchema };
export default UploadWithDiagram;
