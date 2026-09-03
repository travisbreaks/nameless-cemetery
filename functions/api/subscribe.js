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
  if (await isRateLimited(context.env.SIGNUPS, clientIP)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers,
    })
  }

  try {
    const formData = await context.request.formData()

    // Every rejection below returns the ordinary redirect so a bot cannot tell
    // it was caught and start probing for what tripped it.
    const dropSilently = () =>
      Response.redirect(
        new URL('/thank-you/', context.request.url).toString(),
        303
      )

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
    if (
      (origin && origin !== selfOrigin) ||
      (referer && !referer.startsWith(selfOrigin))
    ) {
      return dropSilently()
    }

    const email = formData.get('email')
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

    // Store in KV
    if (context.env.SIGNUPS) {
      await context.env.SIGNUPS.put(key, JSON.stringify({
        email,
        name,
        phone,
        address,
        timestamp,
        ip: clientIP,
      }))
    } else {
      console.error('SIGNUPS KV binding not available')
    }

    // If Brevo is configured, also sync there
    const apiKey = context.env.BREVO_API_KEY
    const listId = parseInt(context.env.BREVO_LIST_ID, 10)

    if (apiKey && listId) {
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
    }

    return Response.redirect(
      new URL('/thank-you/', context.request.url).toString(),
      303
    )
  } catch (err) {
    console.error('Subscribe error:', err)
    return Response.redirect(
      new URL('/thank-you/', context.request.url).toString(),
      303
    )
  }
}
