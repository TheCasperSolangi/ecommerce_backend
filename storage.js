/**
 * storage.js — standalone file-storage server
 *
 * Runs on a separate port (STORAGE_PORT, default 5001) from the main API.
 * All uploaded files are renamed to a UUID v4 so the original filename is
 * never exposed — preventing path traversal, enumeration, and fingerprinting.
 *
 * Endpoints:
 *   POST   /api/uploads                — upload one file
 *   POST   /api/uploads/bulk           — upload up to 10 files
 *   GET    /api/uploads/admin/files    — list all files, paginated  [admin key]
 *   GET    /api/uploads/:filename      — serve a stored file
 *   DELETE /api/uploads/:filename      — delete a file
 */

require('dotenv').config();

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const { v4: uuidv4 } = require('uuid');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STORAGE_PORT   = Number(process.env.STORAGE_PORT    || 5001);
const UPLOAD_DIR     = process.env.UPLOAD_DIR             || path.join(__dirname, 'uploads');
const MAX_FILE_MB    = Number(process.env.MAX_FILE_SIZE_MB || 10);
const ALLOWED_ORIGIN = process.env.STORAGE_ALLOWED_ORIGIN || process.env.CLIENT_URL || '*';
const STORAGE_BASE_URL = process.env.STORAGE_BASE_URL     || `http://localhost:${STORAGE_PORT}`;

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Allowed MIME types
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/avif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4', 'video/webm',
]);

const MIME_TO_EXT = {
  'image/jpeg':    '.jpg',
  'image/png':     '.png',
  'image/gif':     '.gif',
  'image/webp':    '.webp',
  'image/svg+xml': '.svg',
  'image/avif':    '.avif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'video/mp4':  '.mp4',
  'video/webm': '.webm',
};

// ---------------------------------------------------------------------------
// Multer storage — UUID rename, MIME validation
// ---------------------------------------------------------------------------

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext      = MIME_TO_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase();
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ['GET', 'POST', 'DELETE'] }));
app.use(express.json());

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, message: 'Too many upload requests, please try again later' },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i;

const isSafeFilename = (filename) => UUID_FILE_RE.test(filename);

const buildFileUrl = (filename) => `${STORAGE_BASE_URL}/api/uploads/${filename}`;

const formatFileResponse = (file) => ({
  filename:      file.filename,
  original_name: file.originalname,
  mimetype:      file.mimetype,
  size_bytes:    file.size,
  url:           buildFileUrl(file.filename),
});

// ---------------------------------------------------------------------------
// Admin auth middleware — shared-secret bearer token
// ---------------------------------------------------------------------------

/**
 * Protects admin-only endpoints on this standalone server.
 * The main API passes  Authorization: Bearer <STORAGE_ADMIN_KEY>
 * when forwarding requests from a verified admin user.
 *
 * Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(40).toString('hex'))"
 */
const requireAdminKey = (req, res, next) => {
  const adminKey = process.env.STORAGE_ADMIN_KEY;

  if (!adminKey) {
    return res.status(503).json({
      success: false,
      message: 'Admin access is not configured on this storage server',
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== adminKey) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  next();
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/uploads
 * Upload a single file. Field name: "file"
 */
app.post('/api/uploads', uploadLimiter, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file provided' });
  }
  res.status(201).json({
    success: true,
    message: 'File uploaded successfully',
    data: formatFileResponse(req.file),
  });
});

/**
 * POST /api/uploads/bulk
 * Upload up to 10 files at once. Field name: "files"
 */
app.post('/api/uploads/bulk', uploadLimiter, upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files provided' });
  }
  res.status(201).json({
    success: true,
    message: `${req.files.length} file(s) uploaded successfully`,
    data: { files: req.files.map(formatFileResponse) },
  });
});

/**
 * GET /api/uploads/admin/files   [requires STORAGE_ADMIN_KEY]
 *
 * Lists every file on disk with pagination and optional filtering.
 * Must be registered BEFORE the /:filename wildcard route.
 *
 * Query params:
 *   page    — page number (default 1)
 *   limit   — files per page, max 100 (default 20)
 *   ext     — filter by extension, e.g. ?ext=.jpg  or  ?ext=jpg
 *   sort    — newest (default) | oldest | largest | smallest
 */
app.get('/api/uploads/admin/files', requireAdminKey, (req, res) => {
  const { page = 1, limit = 20, ext, sort = 'newest' } = req.query;

  const pageNum  = Math.max(parseInt(page)  || 1,  1);
  const limitNum = Math.min(parseInt(limit) || 20, 100);

  // Read upload directory — only files that match our UUID naming pattern.
  let entries;
  try {
    entries = fs.readdirSync(UPLOAD_DIR).filter(isSafeFilename);
  } catch {
    return res.status(500).json({ success: false, message: 'Could not read upload directory' });
  }

  // Build metadata for each file.
  let files = entries.map((filename) => {
    const filePath = path.join(UPLOAD_DIR, filename);
    const stat     = fs.statSync(filePath);
    return {
      filename,
      url:        buildFileUrl(filename),
      size_bytes: stat.size,
      extension:  path.extname(filename).toLowerCase(),
      created_at: stat.mtime.toISOString(),
    };
  });

  // Optional extension filter.
  if (ext) {
    const normalised = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    files = files.filter((f) => f.extension === normalised);
  }

  // Sort.
  const sorters = {
    newest:   (a, b) => new Date(b.created_at) - new Date(a.created_at),
    oldest:   (a, b) => new Date(a.created_at) - new Date(b.created_at),
    largest:  (a, b) => b.size_bytes - a.size_bytes,
    smallest: (a, b) => a.size_bytes - b.size_bytes,
  };
  files.sort(sorters[sort] || sorters.newest);

  // Paginate.
  const total     = files.length;
  const skip      = (pageNum - 1) * limitNum;
  const pageFiles = files.slice(skip, skip + limitNum);

  res.status(200).json({
    success: true,
    data: {
      files: pageFiles,
      pagination: {
        total,
        page:  pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      },
    },
  });
});

/**
 * GET /api/uploads/:filename
 * Serve a stored file. Filename must match UUID pattern.
 */
app.get('/api/uploads/:filename', (req, res) => {
  const { filename } = req.params;

  if (!isSafeFilename(filename)) {
    return res.status(400).json({ success: false, message: 'Invalid filename' });
  }

  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }

  res.sendFile(filePath);
});

/**
 * DELETE /api/uploads/:filename
 * Remove a file from storage.
 */
app.delete('/api/uploads/:filename', (req, res) => {
  const { filename } = req.params;

  if (!isSafeFilename(filename)) {
    return res.status(400).json({ success: false, message: 'Invalid filename' });
  }

  const filePath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }

  fs.unlinkSync(filePath);
  res.status(200).json({ success: true, message: 'File deleted successfully' });
});

// ---------------------------------------------------------------------------
// Error handler — Multer errors + generic fallback
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE:       `File too large. Maximum size is ${MAX_FILE_MB} MB.`,
      LIMIT_FILE_COUNT:      'Too many files. Maximum 10 files per request.',
      LIMIT_UNEXPECTED_FILE: 'File type not allowed.',
    };
    return res.status(400).json({
      success: false,
      message: messages[err.code] || 'File upload error',
    });
  }

  console.error('[Storage server error]', err.message);
  res.status(500).json({ success: false, message: 'Something went wrong' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(STORAGE_PORT, () => {
  console.log(`📦 Storage server running on port ${STORAGE_PORT}`);
  console.log(`   Upload directory : ${UPLOAD_DIR}`);
  console.log(`   Max file size    : ${MAX_FILE_MB} MB`);
  console.log(`   Allowed origin   : ${ALLOWED_ORIGIN}`);
});

module.exports = app;
