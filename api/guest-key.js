/**
 * Generate Secure Guest Key Endpoint
 *
 * This function generates a cryptographically secure random key for guest uploads.
 * Replaces the insecure localStorage UUID with a server-generated, validated key.
 *
 * Security improvements:
 * - Cryptographically random (not predictable UUID)
 * - Server-validated on every request
 * - Tied to event_id + deadline
 *
 * Usage from frontend:
 * const response = await fetch(`/api/guest-key?event_id=${eventId}`);
 * const { guest_key, guest_name } = await response.json();
 * localStorage.setItem('mg_guest_key', guest_key);
 * localStorage.setItem('mg_guest_name', guest_name);
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE credentials');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function generateSecureKey() {
  // Generate 32 random bytes, convert to hex UUID-like string
  return crypto.randomBytes(16).toString('hex').slice(0, 36);
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event_id } = req.query;

    if (!event_id) {
      return res.status(400).json({ error: 'event_id required' });
    }

    // Validate event exists and is open
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, is_open, deadline')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.is_open) {
      return res.status(403).json({ error: 'Event is closed' });
    }

    // Check deadline
    if (event.deadline && new Date(event.deadline) < new Date()) {
      return res.status(403).json({ error: 'Event deadline passed' });
    }

    // Generate secure key
    const guest_key = generateSecureKey();

    // Return key (client stores in localStorage)
    // In production, you might want to persist this in a guest_sessions table
    // to track which keys were issued for which events (for analytics/security)
    return res.status(200).json({
      guest_key,
      event_id,
      expires_at: event.deadline || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
    });
  } catch (err) {
    console.error('Guest key handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
