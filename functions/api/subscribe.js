// IP-based rate limiting (10 signups per IP per hour).
// The counter has to live in KV, not in module scope. Pages Functions run in
// isolates that are spun up and torn down constantly, spread across every edge
// location, so a module-level Map is empty on most requests and the limit never
// trips. It was written that way and did nothing until 2026-09-03.
const RATE_LIMIT = 10
const RATE_WINDOW_SECONDS = 60 * 60

async function isRateLimited(kv, ip) {
  if (!kv || ip === 'unknown') return false
  const key = `ratelimit:${ip}`
  const count = parseInt((await kv.get(key)) || '0', 10)
  if (count >= RATE_LIMIT) return true
  await kv.put(key, String(count + 1), { expirationTtl: RATE_WINDOW_SECONDS })
  return false
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://namelesscemetery.org',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function onRequestPost(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://namelesscemetery.org',
  }

  const clientIP = context.request.headers.get('CF-Connecting-IP') || 'unknown'

  const redirectTo = (path) =>
    Response.redirect(new URL(path, context.request.url).toString(), 303)

  try {
    // Inside the try: the counter is a KV read and write, and a KV failure here
    // must land on the problem page, not escape as an unhandled error.
    if (await isRateLimited(context.env.SIGNUPS, clientIP)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers,
      })
    }

    const formData = await context.request.formData()

    // Every rejection below returns the ordinary redirect so a bot cannot tell
    // it was caught and start probing for what tripped it.
    const dropSilently = () => redirectTo('/thank-you/')

    // Honeypot, checked two ways.
    // Filled means a bot rendered the form and populated the hidden field, which
    // no human ever does. MISSING means the request never went through our form
    // at all: a script POSTing straight to this endpoint sends only the fields it
    // knows about. That second case is what the late-August 2026 spam was doing
    // (seven addresses, each submitted twice a few hundred milliseconds apart),
    // and the original truthiness-only check let all of it through.
    if (!formData.has('website') || formData.get('website')) {
      return dropSilently()
    }

    // Only accept posts that came from the page itself. Compared against this
    // request's own origin so production, preview deploys, and local dev all work
    // without a hardcoded host. Checked leniently: some browsers and privacy
    // tools strip these headers, and the honeypot above already covers a request
    // with no form behind it, so only a header that is present AND wrong is
    // rejected. Old browsers on this mailing list are not worth breaking.
    const selfOrigin = new URL(context.request.url).origin
    const origin = context.request.headers.get('Origin')
    const referer = context.request.headers.get('Referer')
    // Parse the Referer's origin exactly; a prefix match would let
    // https://namelesscemetery.org.evil.example through.
    let refererOrigin = null
    if (referer) {
      try {
        refererOrigin = new URL(referer).origin
      } catch {
        return dropSilently()
      }
    }
    if (
      (origin && origin !== selfOrigin) ||
      (refererOrigin && refererOrigin !== selfOrigin)
    ) {
      return dropSilently()
    }

    // Turnstile. The widget puts a token in the form; Cloudflare confirms it.
    // A missing or rejected token is not proof of a bot: tokens expire and can
    // be used only once, so a person who left the page open can fail here. Tell
    // them plainly and let them try again instead of thanking them for a signup
    // that was never saved.
    const turnstileSecret = context.env.TURNSTILE_SECRET_KEY
    if (turnstileSecret) {
      const token = formData.get('cf-turnstile-response')
      if (!token) return redirectTo('/signup-verify/')
      const verify = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: turnstileSecret,
            response: token,
            remoteip: clientIP,
          }),
        }
      )
      const outcome = await verify.json()
      if (!outcome.success) return redirectTo('/signup-verify/')
    } else if (context.env.TURNSTILE_BYPASS === 'true') {
      // Explicit opt-out for local development only. Never set this in production.
      console.warn('TURNSTILE_BYPASS is set; skipping Turnstile check')
    } else {
      // No secret and no explicit bypass means a misconfigured deployment. Save
      // nothing rather than take signups with the check silently switched off.
      console.error('TURNSTILE_SECRET_KEY not set; refusing signup')
      return redirectTo('/signup-problem/')
    }

    const email = (formData.get('email') || '').trim().toLowerCase()
    const name = formData.get('name') || ''
    const phone = formData.get('phone') || ''
    const address = formData.get('address') || ''

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers,
      })
    }

    const timestamp = new Date().toISOString()
    const key = `signup:${timestamp}:${email}`

    // Store in KV. Without the binding nothing is saved, so do not send the
    // person to a page that says they were added.
    if (!context.env.SIGNUPS) {
      console.error('SIGNUPS KV binding not available')
      return redirectTo('/signup-problem/')
    }

    // One address, one row. Keys are signup:<timestamp>:<email>, so an
    // existing key ending in this address means they are already on file.
    // Thank them the same way; there is nothing new to record.
    const existing = await context.env.SIGNUPS.list({ prefix: 'signup:' })
    if (existing.keys.some((k) => k.name.toLowerCase().endsWith(`:${email}`))) {
      return redirectTo('/thank-you/')
    }

    await context.env.SIGNUPS.put(key, JSON.stringify({
      email,
      name,
      phone,
      address,
      timestamp,
      ip: clientIP,
    }))

    // If Brevo is configured, also sync there
    const apiKey = context.env.BREVO_API_KEY
    const listId = parseInt(context.env.BREVO_LIST_ID, 10)

    // The signup is already saved above. A Brevo failure must only log; it
    // must not push a saved person to the problem page.
    if (apiKey && listId) {
      try {
        const response = await fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            attributes: {
              FIRSTNAME: name,
              PHONE: phone,
              ADDRESS: address,
            },
            listIds: [listId],
            updateEnabled: true,
          }),
        })

        if (!response.ok && response.status !== 204) {
          const errorData = await response.json()
          if (errorData.code !== 'duplicate_parameter') {
            console.error('Brevo API error:', JSON.stringify(errorData))
          }
        }
      } catch (brevoErr) {
        console.error('Brevo sync failed:', brevoErr)
      }
    }

    return redirectTo('/thank-you/')
  } catch (err) {
    // A thrown read or write means nothing was saved. Say so instead of thanking them.
    console.error('Subscribe error:', err)
    return redirectTo('/signup-problem/')
  }
}
