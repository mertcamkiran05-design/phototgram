/**
 * Daily Backup Cron Job
 *
 * This function runs daily (scheduled via Vercel cron)
 * and exports all events + media metadata to AWS S3
 *
 * Schedule: 0 2 * * * (2 AM UTC daily)
 * Configured in vercel.json
 */

import { createClient } from '@supabase/supabase-js';
import AWS from 'aws-sdk';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const awsBackupBucket = process.env.AWS_BACKUP_BUCKET;
const awsRegion = process.env.AWS_REGION;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE credentials');
}

if (!awsBackupBucket) {
  console.warn('AWS_BACKUP_BUCKET not configured. Backup skipped.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const s3 = new AWS.S3({
  region: awsRegion,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

export default async function handler(req, res) {
  // Verify this is a cron request from Vercel
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const timestamp = new Date().toISOString();
    console.log(`[Backup] Starting backup at ${timestamp}`);

    // Export all events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*');

    if (eventsError) {
      throw eventsError;
    }

    // Export all media metadata (NOT files, just records)
    const { data: media, error: mediaError } = await supabase
      .from('media')
      .select('*');

    if (mediaError) {
      throw mediaError;
    }

    const backup = {
      timestamp,
      stats: {
        events_count: events?.length || 0,
        media_count: media?.length || 0,
      },
      data: {
        events: events || [],
        media: media || [],
      },
    };

    // Upload to S3
    const backupKey = `backups/${new Date().toISOString().split('T')[0]}/backup-${timestamp}.json`;

    await s3
      .putObject({
        Bucket: awsBackupBucket,
        Key: backupKey,
        Body: JSON.stringify(backup, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      })
      .promise();

    console.log(`[Backup] Success. Backed up ${events?.length || 0} events, ${media?.length || 0} media records to ${backupKey}`);

    // Cleanup old backups (keep last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { Contents: objects } = await s3
      .listObjects({
        Bucket: awsBackupBucket,
        Prefix: 'backups/',
      })
      .promise();

    for (const obj of objects || []) {
      if (new Date(obj.LastModified) < thirtyDaysAgo) {
        await s3
          .deleteObject({
            Bucket: awsBackupBucket,
            Key: obj.Key,
          })
          .promise();
        console.log(`[Backup] Deleted old backup: ${obj.Key}`);
      }
    }

    return res.status(200).json({
      success: true,
      backup_key: backupKey,
      stats: backup.stats,
    });
  } catch (err) {
    console.error('[Backup] Error:', err);
    return res.status(500).json({
      error: 'Backup failed',
      message: err.message,
    });
  }
}
