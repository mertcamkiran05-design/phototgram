# Memogram Implementation Guide

## 📋 What Was Created

This is a **security-hardened implementation scaffold** for the Memogram event photo-gathering platform. It includes:

1. ✅ **Supabase Schema** (`supabase-kurulum.sql`)
   - Database tables with proper constraints
   - RLS policies for access control
   - File limit trigger (500 per event)
   - Audit logging tables
   - Indexes for performance

2. ✅ **Vercel Functions** (Server-side security layer)
   - `/api/auth.js` — Secure authentication
   - `/api/guest-key.js` — Cryptographically random key generation
   - `/api/upload.js` — File upload validation + rate limiting
   - `/api/cron/backup.js` — Daily backup to AWS S3

3. ✅ **Environment Setup**
   - `.env.example` — Template for environment variables
   - `vercel.json` — Vercel deployment config
   - `package.json` — Dependencies

4. ✅ **Security Documentation**
   - `SECURITY.md` — Complete security guidelines
   - `CLAUDE.md` — Architecture notes (already updated)

---

## 🚀 Implementation Steps

### Phase 1: Database Setup (30 minutes)

1. **Go to Supabase Dashboard**
   - Project → SQL Editor

2. **Copy entire contents of `supabase-kurulum.sql`**
   - Paste into Supabase SQL Editor
   - Click "Run"

3. **Verify tables created**
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
   ```
   Should show: `events`, `media`, `audit_log`

4. **Check RLS is enabled**
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;
   ```

5. **Rotate Supabase Anon Key**
   - Dashboard → Project Settings → API keys
   - "Reveal" → Copy new key
   - Old key becomes inactive

---

### Phase 2: Vercel Deployment (1 hour)

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Link project to Vercel**
   ```bash
   cd C:\Users\Acer\Documents\phototgram
   vercel link
   ```

3. **Set Environment Variables**
   - Vercel Dashboard → Settings → Environment Variables
   - Add all from `.env.example`:
     ```
     SUPABASE_URL = https://xxxxx.supabase.co
     SUPABASE_ANON_KEY = your_new_key
     SUPABASE_SERVICE_ROLE_KEY = your_service_role_key
     AWS_BACKUP_BUCKET = memogram-backups
     AWS_REGION = us-east-1
     AWS_ACCESS_KEY_ID = xxx
     AWS_SECRET_ACCESS_KEY = xxx
     ENCRYPTION_SECRET = (generate random 32-char string)
     ENVIRONMENT = production
     ```

4. **Deploy**
   ```bash
   vercel deploy --prod
   ```

5. **Verify Functions Work**
   ```bash
   curl https://your-app.vercel.app/api/guest-key?event_id=test-id
   # Should return: { "error": "Event not found" } — expected
   ```

---

### Phase 3: Frontend Integration (2-3 hours)

**You need to modify `Memogram.dc.html` (the source file):**

#### Step 1: Remove Hardcoded Credentials

**Current (UNSAFE):**
```javascript
const supabase = createClient(
  'https://xxxxx.supabase.co',
  'public_anon_key_here'
);
```

**New (SAFE):**
```javascript
let supabase;

async function initSupabase() {
  const response = await fetch('/api/config');
  const config = await response.json();
  supabase = createClient(config.supabase_url, config.supabase_anon_key);
}

// Call at startup
await initSupabase();
```

#### Step 2: Update Authentication Flow

**Current (simple):**
```javascript
function login(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}
```

**New (via server):**
```javascript
function login(email, password) {
  return fetch('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ email, password, action: 'signin' })
  }).then(r => r.json());
}
```

#### Step 3: Generate Guest Keys Server-Side

**Current (UNSAFE — UUID):**
```javascript
const guestKey = localStorage.getItem('mg_guest_key') 
  || crypto.randomUUID();
```

**New (SAFE — server-generated):**
```javascript
async function getGuestKey(eventId) {
  const response = await fetch(`/api/guest-key?event_id=${eventId}`);
  const { guest_key } = await response.json();
  localStorage.setItem('mg_guest_key', guest_key);
  return guest_key;
}

// Call when guest enters event
const guestKey = await getGuestKey(eventId);
```

#### Step 4: Validate Guest Key on Every Request

**Add middleware to all media operations:**
```javascript
async function uploadMedia(file, eventId, guestKey, guestName) {
  // Validate guest key still valid
  const response = await fetch('/api/guest-key', {
    method: 'POST',
    body: JSON.stringify({ guest_key: guestKey, event_id: eventId })
  });
  
  if (!response.ok) {
    throw new Error('Session expired. Please refresh.');
  }

  // Proceed with upload
  // ...
}
```

#### Step 5: Update File Upload Logic

**Current (direct Supabase):**
```javascript
supabase.storage.from('media').upload(path, file);
```

**New (via validation endpoint):**
```javascript
const formData = new FormData();
formData.append('file', file);
formData.append('event_id', eventId);
formData.append('guest_key', guestKey);
formData.append('guest_name', guestName);

const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

#### Step 6: Update Realtime Subscription

**Current (subscribes to all events):**
```javascript
watchEvent(id) {
  const channel = supabase.channel(`event-${id}`)
    .on('*', { schema: 'public', table: 'media' }, callback)
    .subscribe();
}
```

**New (with event_id filter):**
```javascript
watchEvent(id) {
  const channel = supabase
    .channel(`event-${id}`)
    .on('*', 
      { 
        schema: 'public', 
        table: 'media',
        filter: `event_id=eq.${id}`  // 👈 ADD THIS
      }, 
      callback
    )
    .subscribe();
}
```

---

### Phase 4: Testing (1-2 hours)

#### Unit Tests
```bash
npm test
```

#### Manual Security Tests

1. **Test 1: Guest Cannot See Other Events**
   ```bash
   # Open event A in browser 1
   # Open event B in browser 2 (incognito)
   # Copy browser 1's guest key
   # Try to use it in browser 2
   # Expected: Access denied
   ```

2. **Test 2: Rate Limiting**
   ```bash
   # Rapid-fire upload 15 files within 60 seconds
   # Expected: ~10th file succeeds, 11th+ fail
   ```

3. **Test 3: File Limit**
   ```bash
   # Automate uploading 500 files
   # Try to upload 501st
   # Expected: Fails with "Event file limit reached"
   ```

4. **Test 4: Backup**
   ```bash
   # Check Vercel logs for backup job
   vercel logs --tail
   # Look for: "[Backup] Success. Backed up X events..."
   ```

5. **Test 5: Email Verification**
   ```bash
   # Sign up new account
   # Check email for verification link
   # Click link
   # Verify account activated
   ```

---

## 🔧 Configuration Reference

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | — | Public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only key (keep secret!) |
| `AWS_BACKUP_BUCKET` | — | S3 bucket for backups |
| `AWS_REGION` | us-east-1 | AWS region |
| `RATE_LIMIT_UPLOADS_PER_MINUTE` | 10 | Files per guest per minute |
| `MAX_FILE_SIZE_MB` | 50 | Max file size in MB |
| `MAX_FILES_PER_EVENT` | 500 | Event file limit |

### Vercel Function Configuration

Automatically configured in `vercel.json`:

```json
{
  "functions": {
    "api/**/*.js": {
      "memory": 1024,
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/backup",
      "schedule": "0 2 * * *"  // 2 AM UTC daily
    }
  ]
}
```

---

## 📊 Migration Path (From Current to Secure)

### Today (Status)
- ❌ Credentials in index.html
- ❌ Guest key = UUID
- ❌ No rate limiting
- ❌ No backup

### After Phase 1+2 (Database + Vercel)
- ⚠️ Credentials still in old app, but new infrastructure ready
- ✅ RLS policies deployed
- ✅ Backup running

### After Phase 3 (Frontend Integration)
- ✅ All security fixes applied
- ✅ Server-side validation
- ✅ Rate limiting active
- ✅ Backups verified

### After Phase 4 (Testing)
- ✅ Production-ready
- ✅ All tests passing
- ✅ Monitoring active

---

## ⚠️ Common Pitfalls

| Issue | Fix |
|-------|-----|
| "Environment variables undefined" | Set in Vercel dashboard, not `.env.local` |
| "Backup fails with 403" | Check AWS credentials + S3 bucket policy |
| "Upload endpoint returns 501" | Implement multipart form parsing (formidable library) |
| "RLS policies too restrictive" | Test with different users/roles |
| "Guest key expires too soon" | Adjust expiration logic in `/api/guest-key.js` |

---

## 📞 Next Steps

1. **Start Phase 1** (Database setup) — ~30 min
2. **Then Phase 2** (Vercel deployment) — ~1 hour
3. **Then Phase 3** (Update Memogram.dc.html) — 2-3 hours
4. **Then Phase 4** (Testing) — 1-2 hours

**Total Time:** ~6-7 hours

**Questions?** See `SECURITY.md` for detailed security information.

---

Last Updated: 2026-08-13
