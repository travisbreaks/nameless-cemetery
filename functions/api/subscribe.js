// Simple IP-based rate limiting (10 signups per IP per hour)
const rateLimitMap = new Map()
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60 * 60 * 1000

function isRateLimited(ip) {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT
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
  if (isRateLimited(clientIP)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers,
    })
  }

  try {
    const formData = await context.request.formData()
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
