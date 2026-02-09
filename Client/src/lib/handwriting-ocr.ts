// import { pipeline, env } from '@huggingface/transformers';

// // Configure transformers.js
// env.allowLocalModels = false;
// env.useBrowserCache = true;

// let ocrPipeline: any = null;

// // Configuration for model selection
// const MODEL_CONFIG = {
//   // Use your custom trained model (update this path when your model is ready)
//   custom: './models/custom-trocr-handwriting', // Path to your trained model
//   // Fallback to pre-trained model
//   pretrained: 'microsoft/trocr-base-handwritten'
// };

// const initializeOCR = async (useCustomModel: boolean = true) => {
//   if (!ocrPipeline) {
//     const modelPath = useCustomModel ? MODEL_CONFIG.custom : MODEL_CONFIG.pretrained;
//     console.log(`Initializing handwriting OCR model: ${modelPath}...`);
    
//     try {
//       ocrPipeline = await pipeline(
//         'image-to-text',
//         modelPath,
//         { device: 'webgpu' }
//       );
//       console.log('Custom handwriting OCR model ready');
//     } catch (error) {
//       console.warn('Failed to load custom model, falling back to pre-trained:', error);
//       ocrPipeline = await pipeline(
//         'image-to-text',
//         MODEL_CONFIG.pretrained,
//         { device: 'webgpu' }
//       );
//       console.log('Pre-trained handwriting OCR model ready');
//     }
//   }
//   return ocrPipeline;
// };

// export const extractHandwrittenText = async (imageFile: File): Promise<string> => {
//   try {
//     console.log('Starting handwritten text extraction...');
    
//     // Initialize the OCR pipeline
//     const ocr = await initializeOCR();
    
//     // Convert file to image URL
//     const imageUrl = URL.createObjectURL(imageFile);
    
//     // Extract text
//     console.log('Processing image with TrOCR...');
//     const result = await ocr(imageUrl);
    
//     // Clean up URL
//     URL.revokeObjectURL(imageUrl);
    
//     console.log('Text extraction completed:', result);
//     return result.generated_text || '';
    
//   } catch (error) {
//     console.error('Error extracting handwritten text:', error);
//     throw new Error(`Failed to extract text: ${error instanceof Error ? error.message : 'Unknown error'}`);
//   }
// };

// export const extractTextFromMultipleImages = async (imageFiles: File[]): Promise<string[]> => {
//   const results = await Promise.all(
//     imageFiles.map(file => extractHandwrittenText(file))
//   );
//   return results;
// };