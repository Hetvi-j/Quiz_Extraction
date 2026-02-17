/**
 * Diagram API Routes
 * 
 * GET  /api/v1/diagrams/:uploadId              - Get all diagrams from upload
 * GET  /api/v1/diagrams/:uploadId/:diagramId   - Get specific diagram image
 * GET  /api/v1/diagrams/type/:type             - Get diagrams by type
 * GET  /api/v1/diagrams/search                 - Search diagrams with filters
 * POST /api/v1/diagrams/:uploadId/export/:id   - Export diagram as file
 */

import express from 'express';
import {
  getDiagramsByUploadId,
  getDiagramImage,
  getDiagramsByType,
  searchDiagrams,
  exportDiagramAsFile
} from '../controllers/diagramController.js';

const router = express.Router();

/**
 * GET /api/v1/diagrams/:uploadId
 * Get all diagrams from a specific upload
 */
router.get('/:uploadId', async (req, res) => {
  try {
    const result = await getDiagramsByUploadId(req.params.uploadId);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/diagrams/:uploadId/:diagramId
 * Get specific diagram image (returns base64 or URL)
 */
router.get('/:uploadId/:diagramId', async (req, res) => {
  try {
    const result = await getDiagramImage(req.params.uploadId, req.params.diagramId);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/diagrams/type/:type
 * Get all diagrams of a specific type from all uploads
 */
router.get('/type/:type', async (req, res) => {
  try {
    const result = await searchDiagrams({ type: req.params.type });
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/diagrams/search?type=flowchart&minConfidence=0.7&subject=PHYSICS
 * Search diagrams with multiple filters
 */
router.get('/search', async (req, res) => {
  try {
    const filters = {
      type: req.query.type,
      minConfidence: req.query.minConfidence ? parseFloat(req.query.minConfidence) : undefined,
      subjectId: req.query.subjectId
    };
    
    // Remove undefined filters
    Object.keys(filters).forEach(k => filters[k] === undefined && delete filters[k]);
    
    const result = await searchDiagrams(filters);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/diagrams/:uploadId/:diagramId/export
 * Export diagram as PNG file
 */
router.post('/:uploadId/:diagramId/export', async (req, res) => {
  try {
    const fileName = `diagram_${req.params.uploadId}_${req.params.diagramId}.png`;
    const tempPath = path.join(process.cwd(), 'temp', fileName);
    
    // Ensure temp directory exists
    const tempDir = path.dirname(tempPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    await exportDiagramAsFile(
      req.params.uploadId,
      req.params.diagramId,
      tempPath
    );
    
    res.download(tempPath, fileName, (err) => {
      if (err) console.error('Download error:', err);
      // Clean up after download
      fs.unlinkSync(tempPath);
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
