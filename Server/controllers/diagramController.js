/**
 * Diagram Processing Controller
 * Integrates diagram extraction into the document upload workflow
 */

import { extractAllDiagrams } from '../utils/diagramExtractor.js';
import { UploadWithDiagram } from '../models/UploadWithDiagram.js';
import fs from 'fs';
import path from 'path';

/**
 * Extract diagrams from image buffer and store in MongoDB
 * 
 * Usage:
 *   const diagramsInfo = await processDiagramsFromImage(imageBuffer, pageNumber);
 *   
 * Returns:
 *   {
 *     diagrams: [...],
 *     stats: { total, stored, byType, avgConfidence }
 *   }
 */
export async function processDiagramsFromImage(imageBuffer, pageNumber = 1) {
  try {
    console.log(`\n🔍 Processing diagrams from page ${pageNumber}...`);
    
    // Step 1: Detect and extract all diagrams
    const diagrams = await extractAllDiagrams(imageBuffer, pageNumber);
    
    if (!diagrams || diagrams.length === 0) {
      console.log(`✅ No diagrams found on page ${pageNumber}`);
      return {
        diagrams: [],
        stats: {
          total: 0,
          stored: 0,
          byType: {},
          avgConfidence: 0
        }
      };
    }
    
    // Step 2: Calculate statistics
    const stats = {
      total: diagrams.length,
      stored: diagrams.length,
      byType: {},
      avgConfidence: 0
    };
    
    let totalConfidence = 0;
    diagrams.forEach(d => {
      stats.byType[d.type] = (stats.byType[d.type] || 0) + 1;
      totalConfidence += d.confidence;
    });
    stats.avgConfidence = (totalConfidence / diagrams.length).toFixed(2);
    
    console.log(`\n📊 Diagram Statistics:`);
    console.log(`   Total diagrams: ${stats.total}`);
    console.log(`   By type: ${JSON.stringify(stats.byType)}`);
    console.log(`   Avg confidence: ${stats.avgConfidence}`);
    
    return { diagrams, stats };
  } catch (error) {
    console.error('❌ Diagram processing error:', error.message);
    return {
      diagrams: [],
      stats: { total: 0, stored: 0, byType: {}, avgConfidence: 0 }
    };
  }
}

/**
 * Save upload with embedded diagrams to MongoDB
 */
export async function saveUploadWithDiagrams(uploadData, diagrams, pageCount = 1) {
  try {
    // Calculate diagram statistics
    const diagramStats = {
      totalDiagramsFound: diagrams.length,
      diagramsStored: diagrams.length,
      types: {
        flowchart: 0,
        circuit: 0,
        graph: 0,
        mathematical: 0,
        anatomical: 0,
        other: 0
      },
      averageConfidence: 0
    };
    
    let totalConfidence = 0;
    diagrams.forEach(d => {
      if (diagramStats.types[d.type] !== undefined) {
        diagramStats.types[d.type]++;
      } else {
        diagramStats.types.other++;
      }
      totalConfidence += d.confidence;
    });
    
    if (diagrams.length > 0) {
      diagramStats.averageConfidence = (totalConfidence / diagrams.length).toFixed(2);
    }
    
    // Create document with diagrams
    const uploadDocument = new UploadWithDiagram({
      ...uploadData,
      diagrams: diagrams,
      diagramStats: diagramStats
    });
    
    const saved = await uploadDocument.save();
    console.log(`\n✅ Saved upload with ${diagrams.length} diagrams to MongoDB`);
    
    return saved;
  } catch (error) {
    console.error('❌ Save upload with diagrams error:', error.message);
    throw error;
  }
}

/**
 * Retrieve diagrams for a specific upload
 */
export async function getDiagramsByUploadId(uploadId) {
  try {
    const upload = await UploadWithDiagram.findById(uploadId)
      .select('diagrams diagramStats originalName');
    
    if (!upload) {
      throw new Error('Upload not found');
    }
    
    return {
      uploadName: upload.originalName,
      totalDiagrams: upload.diagrams.length,
      diagrams: upload.diagrams,
      stats: upload.diagramStats
    };
  } catch (error) {
    console.error('❌ Get diagrams error:', error.message);
    throw error;
  }
}

/**
 * Get diagrams by type
 */
export async function getDiagramsByType(uploadId, diagramType) {
  try {
    const upload = await UploadWithDiagram.findById(uploadId)
      .select('diagrams');
    
    if (!upload) {
      throw new Error('Upload not found');
    }
    
    const filtered = upload.diagrams.filter(d => d.type === diagramType);
    
    return {
      type: diagramType,
      count: filtered.length,
      diagrams: filtered
    };
  } catch (error) {
    console.error('❌ Get diagrams by type error:', error.message);
    throw error;
  }
}

/**
 * Get single diagram image by upload ID and diagram ID
 */
export async function getDiagramImage(uploadId, diagramId) {
  try {
    const upload = await UploadWithDiagram.findById(uploadId)
      .select('diagrams');
    
    if (!upload) {
      throw new Error('Upload not found');
    }
    
    const diagram = upload.diagrams.find(d => d._id.toString() === diagramId);
    
    if (!diagram) {
      throw new Error('Diagram not found');
    }
    
    // Return diagram image
    if (diagram.image.base64) {
      return {
        success: true,
        base64: diagram.image.base64,
        mimeType: diagram.image.mimeType,
        type: diagram.type,
        coordinates: diagram.coordinates
      };
    } else if (diagram.image.fileReference) {
      return {
        success: true,
        fileUrl: diagram.image.fileReference,
        type: diagram.type,
        coordinates: diagram.coordinates
      };
    } else {
      throw new Error('No image data available');
    }
  } catch (error) {
    console.error('❌ Get diagram image error:', error.message);
    throw error;
  }
}

/**
 * Export diagram as standalone file
 */
export async function exportDiagramAsFile(uploadId, diagramId, outputPath) {
  try {
    const result = await getDiagramImage(uploadId, diagramId);
    
    if (result.base64) {
      const buffer = Buffer.from(result.base64, 'base64');
      fs.writeFileSync(outputPath, buffer);
      console.log(`✅ Exported diagram to: ${outputPath}`);
      return outputPath;
    } else {
      throw new Error('Base64 image not available');
    }
  } catch (error) {
    console.error('❌ Export diagram error:', error.message);
    throw error;
  }
}

/**
 * Get all diagrams across multiple uploads (for search/browse)
 */
export async function searchDiagrams(filters = {}) {
  try {
    let query = {};
    
    if (filters.type) {
      query['diagrams.type'] = filters.type;
    }
    
    if (filters.minConfidence) {
      query['diagrams.confidence'] = { $gte: filters.minConfidence };
    }
    
    if (filters.subjectId) {
      query['subjectId'] = filters.subjectId;
    }
    
    const uploads = await UploadWithDiagram.find(query)
      .select('originalName diagrams diagramStats subjectName')
      .lean();
    
    // Flatten diagrams with parent upload info
    const allDiagrams = [];
    uploads.forEach(upload => {
      upload.diagrams.forEach(diagram => {
        allDiagrams.push({
          ...diagram,
          uploadId: upload._id,
          uploadName: upload.originalName,
          subject: upload.subjectName
        });
      });
    });
    
    return {
      total: allDiagrams.length,
      diagrams: allDiagrams
    };
  } catch (error) {
    console.error('❌ Search diagrams error:', error.message);
    throw error;
  }
}

export default {
  processDiagramsFromImage,
  saveUploadWithDiagrams,
  getDiagramsByUploadId,
  getDiagramsByType,
  getDiagramImage,
  exportDiagramAsFile,
  searchDiagrams
};
