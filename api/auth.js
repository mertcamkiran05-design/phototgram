/**
 * Secure Authentication Endpoint
 *
 * This function provides secure server-side authentication validation.
 * Credentials are NOT passed to client-side code.
 *
 * Usage from frontend:
 * const response = await fetch('/api/auth', {
 *   method: 'POST',
 *   body: JSON.stringify({ email, password, action: 'signin' })
 * });
 * const { session, error } = await response.json();
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Rate limit: simple in-memory tracking (use Redis in production)
const rateLimitMap = new Map();
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(identifier) {
  const now = Date.now();
  const key = `auth:${identifier}`;

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, []);
  }

  const attempts = rateLimitMap.get(key);
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  if (recentAttempts.length >= RATE_LIMIT_ATTEMPTS) {
    return false;
  }

  recentAttempts.push(now);
  rateLimitMap.set(key, recentAttempts);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, action } = req.body;

    // Input validation
    if (!email || !password || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Rate limiting
    if (!checkRateLimit(email)) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (action === 'signin') {
      // Sign in
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Don't expose exact error (prevents user enumeration)
        console.error('Auth error:', error.message);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      return res.status(200).json({
        session: data.session,
        user: data.user,
      });
    } else if (action === 'signup') {
      // Sign up
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false, // Require email verification
      });

      if (error) {
        console.error('Signup error:', error.message);
        return res.status(400).json({ error: 'Failed to create account' });
      }

      // Send verification email (Supabase auto-sends)
      return res.status(200).json({
        message: 'Signup successful. Check your email for verification.',
        user: data.user,
      });
    } else if (action === 'verify-email') {
      // This endpoint would handle email verification token
      return res.status(501).json({ error: 'Not yet implemented' });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (err) {
    console.error('Auth handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
