// import mongoose from 'mongoose';
// const { Schema } = mongoose;

// const questionSchema = new Schema({
//     uploadId: {
//         type: Schema.Types.ObjectId,
//         ref: 'Upload', // Reference to the source Upload
//         required: true,
//         index: true // Key for selecting questions from specific uploads
//     },
//     subjectId: {
//         type: Schema.Types.ObjectId,
//         ref: 'Subject', // Direct link to Subject (for easy querying)
//         required: true,
//         index: true 
//     },
//     question: {
//         type: String,
//         required: true
//     },
//     options: {
//         type: [String],
//         required: true,
//     },
//     answer: {
//         type: String,
//         required: true
//     },
//     difficulty: {
//         type: String,
//         enum: ['Easy', 'Medium', 'Hard'],
//         default: 'Medium'
//     }
// }, { timestamps: true });

// export default mongoose.model('Question', questionSchema);