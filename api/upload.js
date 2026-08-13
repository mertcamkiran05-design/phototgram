/**
 * File Upload Validation & Rate Limiting Endpoint
 *
 * This function validates file uploads before they're stored.
 * Prevents abuse through:
 * - File size validation
 * - File type checking
 * - Rate limiting per guest
 * - Event limit checking
 *
 * Usage from frontend:
 * const formData = new FormData();
 * formData.append('file', file);
 * formData.append('event_id', eventId);
 * formData.append('guest_key', guestKey);
 * formData.append('guest_name', guestName);
 *
 * const response = await fetch('/api/upload', {
 *   method: 'POST',
 *   body: formData
 * });
 * const { path, error } = await response.json();
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const maxFileSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB || 50);
const rateLimitPerMinute = parseInt(process.env.RATE_LIMIT_UPLOADS_PER_MINUTE || 10);
const maxFilesPerEvent = parseInt(process.env.MAX_FILES_PER_EVENT || 500);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE credentials');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Simple rate limiting (use Redis in production)
const uploadAttempts = new Map(); // { guestKey: [timestamp1, timestamp2, ...] }

function checkRateLimit(guestKey) {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  if (!uploadAttempts.has(guestKey)) {
    uploadAttempts.set(guestKey, []);
  }

  const attempts = uploadAttempts.get(guestKey);
  const recentAttempts = attempts.filter(t => t > oneMinuteAgo);

  if (recentAttempts.length >= rateLimitPerMinute) {
    return false;
  }

  recentAttempts.push(now);
  uploadAttempts.set(guestKey, recentAttempts);
  return true;
}

function isAllowedFileType(mimeType, filename) {
  // Allow common photo/video types
  const allowedMimes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'
  ];

  // Also accept by extension if MIME type is missing (mobile)
  const allowedExtensions = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
    'mp4', 'mov', 'avi', 'webm', 'mkv'
  ];

  if (allowedMimes.includes(mimeType)) {
    return true;
  }

  const ext = filename.split('.').pop().toLowerCase();
  return allowedExtensions.includes(ext);
}

function getFileKind(mimeType, filename) {
  if (mimeType?.startsWith('video/') || ['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(filename.split('.').pop().toLowerCase())) {
    return 'video';
  }
  return 'photo';
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse multipart form data (would need 'formidable' or similar in production)
    // For now, return placeholder error
    return res.status(501).json({
      error: 'File upload endpoint requires multipart form handling',
      note: 'Implement with formidable or busboy library'
    });

    /* Full implementation would look like:
    const form = new IncomingForm();
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];
    const { event_id, guest_key, guest_name } = fields;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Validation
    const fileSize = fs.statSync(file.filepath).size;
    if (fileSize > maxFileSizeMb * 1024 * 1024) {
      return res.status(413).json({ error: `File exceeds ${maxFileSizeMb}MB limit` });
    }

    if (!isAllowedFileType(file.mimetype, file.originalFilename)) {
      return res.status(400).json({ error: 'File type not allowed' });
    }

    // Rate limiting
    if (!checkRateLimit(guest_key)) {
      return res.status(429).json({ error: 'Upload rate limit exceeded' });
    }

    // Check event limit
    const { data: mediaCount } = await supabase
      .from('media')
      .select('id', { count: 'exact' })
      .eq('event_id', event_id);

    if ((mediaCount?.length || 0) >= maxFilesPerEvent) {
      return res.status(413).json({ error: 'Event file limit reached' });
    }

    // Upload to Supabase Storage
    const storagePath = `${event_id}/${Date.now()}-${file.originalFilename}`;
    const { data: storageData, error: storageError } = await supabase
      .storage
      .from('media')
      .upload(storagePath, fs.createReadStream(file.filepath));

    if (storageError) {
      throw storageError;
    }

    // Insert media record
    const { data: mediaData, error: mediaError } = await supabase
      .from('media')
      .insert({
        event_id,
        guest_key,
        uploader_name: guest_name,
        path: storagePath,
        kind: getFileKind(file.mimetype, file.originalFilename),
      });

    if (mediaError) {
      throw mediaError;
    }

    return res.status(200).json({
      path: storageData.path,
      media_id: mediaData[0].id,
      kind: mediaData[0].kind,
    });
    */
  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
