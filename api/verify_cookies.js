// verify_cookies.js
// Verification script to test that Hono visitor_id cookies are attached
// correctly under cache hits, and that the /visit endpoint respects and 
// deduplicates visits correctly using this cookie.

async function run() {
  const baseUrl = 'http://localhost:8787';
  const rand = Math.floor(Math.random() * 100000);
  const testEmail = `cookie_tester_${rand}@example.com`;
  const testPassword = 'password123';
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Origin': 'http://localhost:5173'
  };

  console.log('=== STARTING END-TO-END COOKIE & DEDUPLICATION VERIFICATION ===\n');

  // --- Step 1: Sign up a new test user ---
  console.log(`[1/9] Signing up test user: ${testEmail}...`);
  const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });

  if (!signupRes.ok) {
    const errText = await signupRes.text();
    console.error(`FAIL: Signup failed! Status: ${signupRes.status}, Body: ${errText}`);
    process.exit(1);
  }

  const signupData = await signupRes.json();
  const setSessionCookies = signupRes.headers.getSetCookie();
  let decodegoSession = '';
  for (const cookieHeader of setSessionCookies) {
    const match = cookieHeader.match(/decodego_session=([^;]+)/);
    if (match) {
      decodegoSession = match[1];
      break;
    }
  }

  if (!decodegoSession) {
    console.error('FAIL: decodego_session cookie not found in signup response headers!');
    process.exit(1);
  }
  console.log('SUCCESS: Signed up and retrieved session cookie.\n');

  const authHeaders = {
    ...defaultHeaders,
    'Cookie': `decodego_session=${decodegoSession}`
  };

  // --- Step 2: Create a new survey ---
  console.log('[2/9] Creating a new survey...');
  const createRes = await fetch(`${baseUrl}/api/surveys`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ title: `Cookie Test Survey ${rand}` })
  });

  if (!createRes.ok) {
    console.error(`FAIL: Survey creation failed! Status: ${createRes.status}`);
    process.exit(1);
  }

  const createData = await createRes.json();
  const surveyId = createData.survey.id;
  const surveySlug = createData.survey.slug;
  console.log(`SUCCESS: Survey created. ID: ${surveyId}, Slug: ${surveySlug}\n`);

  // --- Step 3: Publish the survey with a question ---
  console.log('[3/9] Publishing the survey with 1 question (so status is not reverted to draft)...');
  const publishRes = await fetch(`${baseUrl}/api/surveys/${surveyId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      status: 'published',
      questions: [
        {
          type: 'short_text',
          label: 'Test Question 1',
          sort_order: 0,
          required: false,
          config: {}
        }
      ]
    })
  });

  if (!publishRes.ok) {
    const errText = await publishRes.text();
    console.error(`FAIL: Publishing survey failed! Status: ${publishRes.status}, Body: ${errText}`);
    process.exit(1);
  }
  console.log('SUCCESS: Survey published.\n');

  // --- Step 4: GET survey (Visitor A - Cache Miss) ---
  console.log('[4/9] Request 1: Visitor A loads survey metadata (Cache Miss)...');
  const surveyUrl = `${baseUrl}/api/public/survey/${surveySlug}`;
  const res1 = await fetch(surveyUrl, { headers: { 'Origin': 'http://localhost:5173' } });
  
  if (!res1.ok) {
    console.error(`FAIL: Failed to fetch survey! Status: ${res1.status}`);
    process.exit(1);
  }

  const setCookieHeaders1 = res1.headers.getSetCookie();
  let visitorId1 = '';
  for (const cookieHeader of setCookieHeaders1) {
    const match = cookieHeader.match(/visitor_id=([^;]+)/);
    if (match) {
      visitorId1 = match[1];
      break;
    }
  }

  if (!visitorId1) {
    console.error('FAIL: visitor_id cookie missing in Request 1!');
    process.exit(1);
  }
  console.log(`SUCCESS: Visitor A received visitor_id: ${visitorId1}\n`);

  // --- Step 5: Brief pause to ensure KV cache write settles ---
  console.log('[5/9] Pausing 150ms to ensure KV cache write is settled...');
  await new Promise(resolve => setTimeout(resolve, 150));
  console.log('SUCCESS: KV cache write settled.\n');

  // --- Step 6: GET survey (Visitor B - Cache Hit) ---
  console.log('[6/9] Request 2: Visitor B loads survey metadata (Cache Hit)...');
  const res2 = await fetch(surveyUrl, { headers: { 'Origin': 'http://localhost:5173' } });
  
  if (!res2.ok) {
    console.error(`FAIL: Failed to fetch survey! Status: ${res2.status}`);
    process.exit(1);
  }

  const setCookieHeaders2 = res2.headers.getSetCookie();
  let visitorId2 = '';
  for (const cookieHeader of setCookieHeaders2) {
    const match = cookieHeader.match(/visitor_id=([^;]+)/);
    if (match) {
      visitorId2 = match[1];
      break;
    }
  }

  if (!visitorId2) {
    console.error('FAIL: visitor_id cookie missing in Request 2 (Cache Hit path)!');
    process.exit(1);
  }
  console.log(`Visitor B received visitor_id: ${visitorId2}`);

  if (visitorId1 === visitorId2) {
    console.error('FAIL: Visitor A and Visitor B received the same visitor_id!');
    process.exit(1);
  }
  console.log('SUCCESS: Visitor A and Visitor B received distinct visitor_ids on KV cache-hit path.\n');

  // --- Step 7: GET survey returning (Visitor A returning - with Cookie) ---
  console.log('[7/9] Request 3: Visitor A returning (With Cookie)...');
  const res3 = await fetch(surveyUrl, {
    headers: {
      'Origin': 'http://localhost:5173',
      'Cookie': `visitor_id=${visitorId1}`
    }
  });

  const setCookieHeaders3 = res3.headers.getSetCookie();
  let hasVisitorCookie = false;
  for (const cookieHeader of setCookieHeaders3) {
    if (cookieHeader.includes('visitor_id=')) {
      hasVisitorCookie = true;
    }
  }

  if (hasVisitorCookie) {
    console.error('FAIL: Set-Cookie header returned even though client sent a valid visitor_id cookie!');
    process.exit(1);
  }
  console.log('SUCCESS: No Set-Cookie header returned when client already has a visitor_id cookie.\n');

  // --- Step 8: POST /visit (Visitor A - First Visit) ---
  console.log('[8/9] Request 4: Visitor A fires POST /visit with cookie...');
  const visitUrl = `${surveyUrl}/visit`;
  const visitRes1 = await fetch(visitUrl, {
    method: 'POST',
    headers: {
      ...defaultHeaders,
      'Cookie': `visitor_id=${visitorId1}`
    }
  });

  if (!visitRes1.ok) {
    console.error(`FAIL: First visit POST failed! Status: ${visitRes1.status}`);
    process.exit(1);
  }
  const visitData1 = await visitRes1.json();
  console.log(`Response 4: ${JSON.stringify(visitData1)}`);

  console.log('Request 5: Visitor A fires POST /visit again (Deduplication)...');
  const visitRes2 = await fetch(visitUrl, {
    method: 'POST',
    headers: {
      ...defaultHeaders,
      'Cookie': `visitor_id=${visitorId1}`
    }
  });

  if (!visitRes2.ok) {
    console.error(`FAIL: Second visit POST failed! Status: ${visitRes2.status}`);
    process.exit(1);
  }
  const visitData2 = await visitRes2.json();
  console.log(`Response 5: ${JSON.stringify(visitData2)}`);
  console.log('SUCCESS: Both visit POST requests completed.\n');

  // --- Step 9: Verify analytics count ---
  console.log('[9/9] Checking analytics response for survey to confirm deduplication...');
  const analyticsRes = await fetch(`${baseUrl}/api/responses/${surveyId}/analytics`, {
    headers: authHeaders
  });

  if (!analyticsRes.ok) {
    console.error(`FAIL: Failed to fetch survey analytics! Status: ${analyticsRes.status}`);
    process.exit(1);
  }

  const analyticsData = await analyticsRes.json();
  console.log(`Visits returned in analytics: ${analyticsData.visits}`);

  if (analyticsData.visits !== 1) {
    console.error(`FAIL: Expected exactly 1 visit, but got ${analyticsData.visits}! Deduplication failed.`);
    process.exit(1);
  }

  console.log('SUCCESS: Cookie-based deduplication correctly counted exactly 1 visit from 2 sequential requests.');
  console.log('\n🎉 ALL END-TO-END COOKIE & DEDUPLICATION VERIFICATIONS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Error running verification:', err);
  process.exit(1);
});
