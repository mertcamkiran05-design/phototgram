# Memogram Security Guidelines

## 🔐 Critical Security Checklist

### Before Production Launch

- [ ] **Credentials Management**
  - [ ] Remove hardcoded Supabase keys from index.html
  - [ ] Set environment variables in Vercel dashboard
  - [ ] Rotate existing Supabase anon key
  - [ ] Use service role key only in server functions

- [ ] **Authentication**
  - [ ] Implement email verification before event creation
  - [ ] Rate limit login attempts (5 attempts per 15 min)
  - [ ] Test password reset flow
  - [ ] Disable public signup if not needed

- [ ] **Authorization**
  - [ ] Verify RLS policies on events + media tables
  - [ ] Test guest cannot view other events
  - [ ] Test guest cannot modify event settings
  - [ ] Test owner can only manage own events

- [ ] **Guest Key Security**
  - [ ] Use `/api/guest-key` endpoint (server-generated)
  - [ ] Validate guest key on every request
  - [ ] Implement key expiration (tied to deadline)
  - [ ] Log guest key usage for audit trail

- [ ] **File Uploads**
  - [ ] Implement `/api/upload` validation
  - [ ] Enforce file size limits (50 MB default)
  - [ ] Allow only image/video MIME types
  - [ ] Scan uploaded files for malware (optional: VirusTotal API)
  - [ ] Implement rate limiting (10 files per minute per guest)
  - [ ] Validate event file limit enforcement

- [ ] **Data Protection**
  - [ ] Enable Supabase audit logging
  - [ ] Implement daily backups to AWS S3
  - [ ] Test backup restoration process
  - [ ] Encrypt sensitive data at rest (Supabase + S3)

- [ ] **Logging & Monitoring**
  - [ ] Log failed authentication attempts
  - [ ] Log file uploads with uploader info
  - [ ] Log event deletions
  - [ ] Setup error tracking (Sentry / Rollbar)
  - [ ] Monitor for unusual activity (burst uploads, etc.)

- [ ] **Infrastructure**
  - [ ] Enable CORS restrictions (Vercel)
  - [ ] Set security headers (CSP, X-Frame-Options, etc.)
  - [ ] Enable HTTPS only
  - [ ] Use Vercel serverless functions (auto-scaling)

---

## 🛡️ Known Vulnerabilities & Mitigations

### S1: Hardcoded Credentials (CRITICAL)

**Status:** ⚠️ NOT FIXED YET

**Issue:** Supabase URL + anon key embedded in index.html

**Risk:** Anyone with the compiled HTML can access the API

**Mitigation:**
```javascript
// OLD (UNSAFE):
const supabase = createClient('https://xxx.supabase.co', 'anon_key_here');

// NEW (SAFE):
// Fetch credentials from API endpoint instead
const response = await fetch('/api/config');
const { supabase_url, anon_key } = await response.json();
```

**Action:** This requires rebuilding the HTML with dynamic credential loading.

---

### S3: Guest Key = Device UUID (CRITICAL)

**Status:** ⚠️ NOT FIXED YET

**Issue:** Guest key is predictable device UUID

**Risk:** Attackers can guess keys, impersonate guests

**Mitigation:** Use `/api/guest-key` endpoint

```javascript
// OLD (UNSAFE):
const guestKey = localStorage.getItem('mg_guest_key') || crypto.randomUUID();

// NEW (SAFE):
const response = await fetch(`/api/guest-key?event_id=${eventId}`);
const { guest_key } = await response.json();
localStorage.setItem('mg_guest_key', guest_key);
```

**Validation:** Server must validate key on every request

---

### A1: No Event Access Control (CRITICAL)

**Status:** ⚠️ PARTIALLY FIXED

**Issue:** Guests can watch any event's realtime feed

**Mitigation:** RLS policy check (added in supabase-kurulum.sql)

```sql
CREATE POLICY "media_read_guests_and_owners" ON media
  FOR SELECT
  USING (
    (events.is_open = true AND events.id = event_id)
    OR
    (auth.uid() = events.owner_id AND events.id = event_id)
  );
```

**Validation:** Test by trying to access event_id from different event

---

### S2: No Rate Limiting (CRITICAL)

**Status:** ⚠️ NOT FIXED YET

**Issue:** Guest can upload 500 files (DoS)

**Mitigation:** Implemented in `/api/upload.js` + SQL trigger

- Per-guest rate limit: 10 files/minute (configurable)
- File limit trigger in database: 500 per event (atomic)

---

### O2: No Backup Strategy (CRITICAL)

**Status:** ⚠️ NOT FIXED YET

**Issue:** Supabase outage/deletion = total data loss

**Mitigation:** Daily backup to AWS S3

```bash
# Scheduled via Vercel cron (api/cron/backup.js)
# Runs daily at 2 AM UTC
# Keeps 30-day rolling backup
```

**Setup:**
1. Create AWS S3 bucket: `memogram-backups`
2. Set AWS credentials in Vercel env vars
3. Deploy backup function
4. Monitor backup success via logs

---

### D1: File Limit Race Condition (HIGH)

**Status:** ⚠️ PARTIALLY FIXED

**Issue:** Concurrent uploads can exceed 500 limit

**Mitigation:** Database trigger with LOCK + atomic counter

```sql
CREATE TRIGGER media_limit_trigger
BEFORE INSERT ON media
FOR EACH ROW
EXECUTE FUNCTION check_media_limit();
```

The function uses `FOR UPDATE` lock to prevent race conditions.

---

## 🔍 Security Testing Checklist

### Manual Tests

```bash
# 1. Test guest key generation
curl -X GET 'http://localhost/api/guest-key?event_id=xxx'

# 2. Test unauthorized event access
# Try to view event_id from different browser/incognito window

# 3. Test file upload limits
# Upload 500 files, verify 501st fails

# 4. Test rate limiting
# Rapid-fire 15 uploads within 60 seconds

# 5. Test RLS policies
# Use Supabase dashboard to verify row-level access
```

### Automated Security Checks

```bash
npm run security-audit          # Check dependency vulnerabilities
npm run lint                    # Check code quality
# Add SAST tools: Snyk, Trivy, etc.
```

---

## 🚨 Incident Response Plan

### If Credentials are Leaked

1. **Immediate (5 min):**
   - Rotate Supabase anon key in dashboard
   - Revoke old key
   - Restart application

2. **Short term (1 hour):**
   - Check Supabase audit logs for unauthorized access
   - Review all events/media for suspicious changes
   - Notify users of potential data exposure

3. **Post-incident (1 day):**
   - Implement env var credentials (fix S1)
   - Add credential rotation alerts
   - Audit all other secrets

---

### If Data is Deleted

1. **Immediate:**
   - Stop accepting new uploads
   - Alert users
   - Check backup status

2. **Recovery:**
   - Restore latest backup from S3
   - Verify data integrity
   - Roll back to clean state

3. **Prevention:**
   - Enable Supabase audit logging
   - Implement soft deletes (audit trail)
   - Add approval workflow for deletions

---

## 📋 Compliance Checklist

- [ ] **GDPR**
  - [ ] Implement data export endpoint (user can download their data)
  - [ ] Implement delete account (cascades to all user data)
  - [ ] Privacy policy updated
  - [ ] Terms of service updated

- [ ] **Data Retention**
  - [ ] Define retention period (e.g., 90 days after event)
  - [ ] Implement automatic deletion
  - [ ] Keep audit trail of deletions

- [ ] **Liability**
  - [ ] Disclaimer: user owns uploaded content
  - [ ] Acceptable use policy (no malware, illegal content, etc.)
  - [ ] DMCA takedown process documented

---

## 🔗 Security Resources

- [Supabase Security Best Practices](https://supabase.com/docs/guides/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Vercel Security](https://vercel.com/security)
- [AWS S3 Security](https://docs.aws.amazon.com/s3/latest/userguide/security.html)

---

## 📞 Security Reporting

If you discover a security vulnerability:

1. **DO NOT** open a public GitHub issue
2. Email security team: security@yourdomain.com
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)

**Expected response:** 48 hours

---

Last Updated: 2026-08-13
