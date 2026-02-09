import mongoose from 'mongoose';
const { Schema } = mongoose;

const uploadSchema = new Schema({
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
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    errorMessage: {
        type: String,
        default: null
    },
    processedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

export default mongoose.model('Upload', uploadSchema);
