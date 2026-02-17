/**
 * Diagram Detection & Extraction Utility
 * 
 * Detects diagrams in document images and stores them in MongoDB
 * Uses image analysis (contour detection, entropy) and optional LLM confirmation
 */

import cv from 'opencv-python';  // For advanced: use python subprocess or webassembly
import sharp from 'sharp';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

/**
 * Detect diagrams in image using visual features
 * Returns array of diagram regions with bounding boxes
 */
export async function detectDiagramsInImage(imageBuffer) {
  try {
    // Use sharp for image processing
    const metadata = await sharp(imageBuffer).metadata();
    
    // Approach 1: Use Groq Vision to identify diagram areas
    const diagramRegions = await identifyDiagramsWithVision(imageBuffer);
    
    if (diagramRegions && diagramRegions.length > 0) {
      return diagramRegions;
    }

    // Approach 2: Fallback - detect high-contrast, structured regions
    return await detectStructuredRegions(imageBuffer, metadata);
  } catch (error) {
    console.error('❌ Diagram detection error:', error.message);
    return [];
  }
}

/**
 * Use Groq Vision LLM to identify diagram regions
 */
async function identifyDiagramsWithVision(imageBuffer) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) return [];

  try {
    const base64Image = imageBuffer.toString('base64');
    
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this image and identify ANY diagrams, flowcharts, graphs, circuit diagrams, mathematical diagrams, or visual illustrations.

For EACH diagram found, provide:
1. Location description (e.g., "top-left", "center", "bottom")
2. Type of diagram (e.g., flowchart, circuit, graph, mathematical)
3. Approximate coordinates: estimate relative position and size as percentages (e.g., x: 10%, y: 20%, width: 40%, height: 30%)

Return as JSON:
{
  "hasDiagrams": true/false,
  "diagrams": [
    {
      "type": "flowchart|circuit|graph|mathematical|other",
      "location": "description",
      "x": <percentage>, 
      "y": <percentage>,
      "width": <percentage>,
      "height": <percentage>,
      "confidence": <0-1 confidence score>
    }
  ]
}

Be very specific about coordinates. Only return diagrams, not text or tables.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: 1024
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content);
    
    return parsed.diagrams || [];
  } catch (error) {
    console.warn('⚠️  Vision LLM diagram detection failed:', error.message);
    return [];
  }
}

/**
 * Fallback: Detect high-contrast regions (visual diagrams usually have distinct patterns)
 */
async function detectStructuredRegions(imageBuffer, metadata) {
  try {
    // Approach: Detect edge density using sharp
    // High edges = likely diagram or structured content
    
    const { width, height } = metadata;
    
    // Grid-based detection: divide image into regions
    const gridSize = 4;  // 4x4 grid
    const regions = [];
    
    // Use sharp to get histogram data for each region
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const x = Math.floor((col / gridSize) * width);
        const y = Math.floor((row / gridSize) * height);
        const w = Math.floor(width / gridSize);
        const h = Math.floor(height / gridSize);
        
        // Extract region
        const regionBuffer = await sharp(imageBuffer)
          .extract({ left: x, top: y, width: w, height: h })
          .toBuffer();
        
        // Estimate edge density (simple: convert to grayscale and check variance)
        const edgeDensity = await estimateEdgeDensity(regionBuffer);
        
        // If edge density is high, likely has diagram/structure
        if (edgeDensity > 0.3) {  // Threshold: 0.3 = rich visual content
          regions.push({
            type: 'structured_region',
            x: Math.round((col / gridSize) * 100),
            y: Math.round((row / gridSize) * 100),
            width: Math.round(100 / gridSize),
            height: Math.round(100 / gridSize),
            edgeDensity: edgeDensity,
            confidence: Math.min(edgeDensity, 1.0)
          });
        }
      }
    }
    
    return regions;
  } catch (error) {
    console.warn('⚠️  Structured region detection failed:', error.message);
    return [];
  }
}

/**
 * Estimate edge density in image region (simple metric)
 */
async function estimateEdgeDensity(imageBuffer) {
  try {
    // Convert to grayscale and get stats
    const stats = await sharp(imageBuffer)
      .grayscale()
      .stats();
    
    // Higher contrast (deviation) = more likely to be diagram
    return Math.min(stats.channels[0].stdDev / 128, 1.0);
  } catch (error) {
    return 0;
  }
}

/**
 * Extract diagram image from full page image using bounding box
 */
export async function extractDiagramImage(imageBuffer, diagramRegion) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    
    // Convert percentage coordinates to pixels
    const x = Math.floor((diagramRegion.x / 100) * width);
    const y = Math.floor((diagramRegion.y / 100) * height);
    const w = Math.floor((diagramRegion.width / 100) * width);
    const h = Math.floor((diagramRegion.height / 100) * height);
    
    // Add padding for context
    const padding = 20;
    const paddedX = Math.max(0, x - padding);
    const paddedY = Math.max(0, y - padding);
    const paddedW = Math.min(width - paddedX, w + 2 * padding);
    const paddedH = Math.min(height - paddedY, h + 2 * padding);
    
    // Extract and convert to base64
    const diagramBuffer = await sharp(imageBuffer)
      .extract({
        left: paddedX,
        top: paddedY,
        width: paddedW,
        height: paddedH
      })
      .png()
      .toBuffer();
    
    const base64 = diagramBuffer.toString('base64');
    
    return {
      base64Image: base64,
      mimeType: 'image/png',
      size: diagramBuffer.length,
      coordinates: {
        x: diagramRegion.x,
        y: diagramRegion.y,
        width: diagramRegion.width,
        height: diagramRegion.height
      }
    };
  } catch (error) {
    console.error('❌ Diagram extraction error:', error.message);
    return null;
  }
}

/**
 * Save diagram to file (if storing on disk instead of DB)
 */
export async function saveDiagramToFile(base64Image, outputDir, filename) {
  try {
    const buffer = Buffer.from(base64Image, 'base64');
    const filepath = path.join(outputDir, filename);
    
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(filepath, buffer);
    return filepath;
  } catch (error) {
    console.error('❌ Diagram file save error:', error.message);
    return null;
  }
}

/**
 * Process entire document: find all diagrams and collect them
 */
export async function extractAllDiagrams(imageBuffer, pageNumber = 1) {
  const diagrams = [];
  
  try {
    // Step 1: Detect diagram regions
    const diagramRegions = await detectDiagramsInImage(imageBuffer);
    
    if (!diagramRegions || diagramRegions.length === 0) {
      console.log(`✅ No diagrams detected on page ${pageNumber}`);
      return diagrams;
    }
    
    console.log(`📊 Found ${diagramRegions.length} diagram(s) on page ${pageNumber}`);
    
    // Step 2: Extract each diagram
    for (let i = 0; i < diagramRegions.length; i++) {
      const region = diagramRegions[i];
      const extracted = await extractDiagramImage(imageBuffer, region);
      
      if (extracted) {
        diagrams.push({
          pageNumber: pageNumber,
          diagramIndex: i + 1,
          type: region.type || 'unknown',
          location: region.location || 'unspecified',
          confidence: region.confidence || 0.7,
          image: {
            base64: extracted.base64Image,
            mimeType: extracted.mimeType,
            size: extracted.size
          },
          coordinates: extracted.coordinates,
          detectedAt: new Date()
        });
        
        console.log(`  ✅ Extracted diagram ${i + 1}: ${region.type} (confidence: ${region.confidence?.toFixed(2)})`);
      }
    }
    
    return diagrams;
  } catch (error) {
    console.error('❌ Diagram extraction batch error:', error.message);
    return diagrams;
  }
}
