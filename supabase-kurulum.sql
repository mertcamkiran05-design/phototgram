-- Memogram / Phototgram Supabase Setup
-- Şema + RLS + Realtime + Storage kurulumu
-- SQL Editor'de baştan sona çalıştırılır

-- ============================================
-- 1. TABLES
-- ============================================

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_date DATE,
  deadline DATE,
  welcome TEXT,
  theme TEXT,
  is_open BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Media table (photos/videos)
CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploader UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_key UUID,
  uploader_name TEXT,
  path TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('photo', 'video')),
  created_at TIMESTAMP DEFAULT now()
);

-- ============================================
-- 2. INDEXES (Performance)
-- ============================================

CREATE INDEX IF NOT EXISTS idx_events_owner_id ON events(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_event_id ON media(event_id);
CREATE INDEX IF NOT EXISTS idx_media_guest_key ON media(guest_key);
CREATE INDEX IF NOT EXISTS idx_media_uploader ON media(uploader);

-- ============================================
-- 3. FILE LIMIT TRIGGER (500 per event)
-- ============================================

CREATE OR REPLACE FUNCTION check_media_limit()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
  limit_per_event INT := 500;
BEGIN
  -- LOCK to prevent race condition
  SELECT COUNT(*) INTO current_count
  FROM media
  WHERE event_id = NEW.event_id
  FOR UPDATE;

  IF current_count >= limit_per_event THEN
    RAISE EXCEPTION 'Event has reached maximum file limit (%)' , limit_per_event;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_limit_trigger
BEFORE INSERT ON media
FOR EACH ROW
EXECUTE FUNCTION check_media_limit();

-- ============================================
-- 4. RLS POLICIES
-- ============================================

-- Enable RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;

-- EVENTS: Anyone can read (discovery)
CREATE POLICY "events_read_all" ON events
  FOR SELECT USING (true);

-- EVENTS: Only owner can update/delete
CREATE POLICY "events_update_owner" ON events
  FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "events_delete_owner" ON events
  FOR DELETE
  USING (auth.uid() = owner_id);

-- EVENTS: Authenticated users can insert (create events)
CREATE POLICY "events_insert_authenticated" ON events
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

-- ============================================
-- 5. MEDIA RLS POLICIES (Critical)
-- ============================================

-- MEDIA: Read policy (guests + owners can see)
-- Guests: read media for event if event is_open
-- Owners: read all media for their events
CREATE POLICY "media_read_guests_and_owners" ON media
  FOR SELECT
  USING (
    (events.is_open = true AND events.id = event_id)
    OR
    (auth.uid() = events.owner_id AND events.id = event_id)
  );

-- MEDIA: Insert policy (guests + authenticated can upload)
-- Guests: upload if event is_open, deadline not passed, have guest_key
-- Authenticated: upload to own events
CREATE POLICY "media_insert_guests_and_authenticated" ON media
  FOR INSERT
  WITH CHECK (
    CASE
      WHEN auth.role() = 'authenticated' THEN
        (SELECT owner_id FROM events WHERE id = event_id) = auth.uid()
      WHEN auth.role() = 'anon' THEN
        EXISTS (
          SELECT 1 FROM events
          WHERE id = event_id
          AND is_open = true
          AND (deadline IS NULL OR deadline >= CURRENT_DATE)
        )
      ELSE false
    END
  );

-- MEDIA: Delete policy (only authenticated users can delete)
-- Owner can delete any media in their event
-- Uploader can delete their own media
CREATE POLICY "media_delete_owner_or_uploader" ON media
  FOR DELETE
  USING (
    (auth.uid() = (SELECT owner_id FROM events WHERE id = event_id))
    OR
    (auth.uid() = uploader)
  );

-- ============================================
-- 6. STORAGE SETUP
-- ============================================

-- Create bucket (if not exists via UI, run this)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for 'media' bucket
CREATE POLICY "Allow anon upload" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'media'
    AND (
      SELECT is_open FROM events
      WHERE id = (storage.foldername(name))[1]::uuid
    ) = true
  );

CREATE POLICY "Allow owner delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'media'
    AND auth.uid() = (
      SELECT owner_id FROM events
      WHERE id = (storage.foldername(name))[1]::uuid
    )
  );

CREATE POLICY "Allow public read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media');

-- ============================================
-- 7. REALTIME SETUP
-- ============================================

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE events;
ALTER PUBLICATION supabase_realtime ADD TABLE media;

-- Set replica identity to full (for UPDATE tracking)
ALTER TABLE events REPLICA IDENTITY FULL;
ALTER TABLE media REPLICA IDENTITY FULL;

-- ============================================
-- 8. AUDIT LOGGING TABLE (Optional but recommended)
-- ============================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  user_id UUID REFERENCES auth.users(id),
  changes JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Audit trigger for events
CREATE OR REPLACE FUNCTION audit_event_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (action, table_name, record_id, user_id, changes)
  VALUES (
    TG_OP,
    'events',
    COALESCE(NEW.id, OLD.id),
    auth.uid(),
    CASE
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', OLD)
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', OLD, 'after', NEW)
      WHEN TG_OP = 'INSERT' THEN jsonb_build_object('inserted', NEW)
    END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_trigger
AFTER INSERT OR UPDATE OR DELETE ON events
FOR EACH ROW
EXECUTE FUNCTION audit_event_changes();

-- ============================================
-- 9. SECURITY NOTES
-- ============================================
--
-- ⚠️  CREDENTIALS
-- Supabase URL and ANON_KEY should NOT be in code
-- Use environment variables (Vercel):
--   SUPABASE_URL=https://xxxxx.supabase.co
--   SUPABASE_ANON_KEY=xxxxx
--   SUPABASE_SERVICE_ROLE_KEY=xxxxx (server-side only)
--
-- ⚠️  GUEST KEY GENERATION
-- mg_guest_key in localStorage should be:
--   1. Generated server-side (Vercel Function)
--   2. Returned to client and stored in localStorage
--   3. Validated on every request
--
-- ⚠️  REALTIME FILTERING
-- Subscriptions should include event_id filter:
--   supabase
--     .channel(`event-${eventId}`)
--     .on('*', { schema: 'public', table: 'media', filter: `event_id=eq.${eventId}` }, ...)
--
-- ⚠️  RATE LIMITING
-- Add per-guest rate limit (see trigger below)
--
-- ⚠️  BACKUP
-- Implement daily backup to S3/GCS
--
